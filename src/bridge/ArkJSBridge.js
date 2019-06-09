// @flow
import invariant from 'invariant'
import logger from 'logger'
import React from 'react'
import { Observable } from 'rxjs'
import { BigNumber } from 'bignumber.js'
import type { Account, Operation } from '@ledgerhq/live-common/lib/types'
import {
  getDerivationModesForCurrency,
  getDerivationScheme,
  runDerivationScheme,
  isIterableDerivationMode,
  derivationModeSupportsIndex,
} from '@ledgerhq/live-common/lib/derivation'
import {
  NotEnoughBalance,
  FeeNotLoaded,
  NotEnoughBalanceBecauseDestinationNotCreated,
  InvalidAddressBecauseDestinationIsAlsoSource,
} from '@ledgerhq/errors'
import {
  getAccountPlaceholderName,
  getNewAccountPlaceholderName,
} from '@ledgerhq/live-common/lib/account'
import FeesRippleKind from 'components/FeesField/RippleKind'
import AdvancedOptionsRippleKind from 'components/AdvancedOptions/RippleKind'
import getAddress from 'commands/getAddress'
import ArkAPI from '@arkecosystem/client'
import ArkCrypto from '@arkecosystem/crypto'
import type { WalletBridge, EditProps } from './types'

const defaultEndpoint = 'https://api.ark.io'

type Transaction = {
  amount: BigNumber,
  recipient: string,
  fee: ?BigNumber,
  vendorField: ?string,
}

type Tx = {
  id: string,
  blockId: string,
  version: number,
  type: number,
  amount: number,
  fee: number,
  sender: string,
  recipient: string,
  signature: string,
  vendorField: string,
  confirmations: number,
  timestamp: {
    epoch: number,
    unix: number,
    human: string
  }
}

function mergeOps(existing: Operation[], newFetched: Operation[]) {
  const ids = existing.map(o => o.id)
  const all = existing.concat(newFetched.filter(o => !ids.includes(o.id)))
  return all.sort((a, b) => b.date - a.date)
}

function isRecipientValid(account, recipient) {
  try {
    ArkCrypto.crypto.validateAddress(recipient, 23) // 23 is the ARK Mainnet version

    return !(account && account.freshAddress === recipient)
  } catch (e) {
    return false
  }
}

function getRecipientWarning(account, recipient) {
  if (account.freshAddress === recipient) {
    return new InvalidAddressBecauseDestinationIsAlsoSource()
  }
  return null
}

const txToOperation = (account: Account) => (data: Tx): ?Operation => {
  const type = data.sender === account.freshAddress ? 'OUT' : 'IN'
  let value = data.amount ? BigNumber(data.amount) : BigNumber(0)
  const feeValue = BigNumber(data.fee)
  if (type === 'OUT') {
    if (!isNaN(feeValue)) {
      value = value.plus(feeValue)
    }
  }

  const op: $Exact<Operation> = {
    id: `${account.id}-${data.id}-${type}`,
    hash: data.id,
    accountId: account.id,
    type,
    value,
    fee: feeValue,
    blockHash: data.blockId,
    blockHeight: data.timestamp.epoch,
    senders: [data.sender],
    recipients: [data.recipient],
    date: new Date(data.timestamp.human),
    transactionSequenceNumber: data.confirmations,
    extra: {},
  }

  if (data.vendorField) {
    op.extra.vendorField = data.vendorField
  }
  return op
}

const EditFees = ({ account, onChange, value }: EditProps<Transaction>) => (
  <FeesRippleKind
    onChange={fee => {
      onChange({ ...value, fee })
    }}
    fee={value.fee}
    account={account}
  />
)

const EditAdvancedOptions = ({ onChange, value }: EditProps<Transaction>) => (
  <AdvancedOptionsRippleKind
    tag={value.vendorField}
    onChangeTag={tag => {
      onChange({ ...value, tag })
    }}
  />
)

const genericError = new Error('UnsupportedBridge')

const ArkBridge: WalletBridge<Transaction> = {
  EditFees,
  EditAdvancedOptions,

  synchronize: (account) =>
    Observable.create(o => {
      let finished = false
      const unsubscribe = () => {
        finished = true
      }

      async function main() {
        try {
          const api = new ArkAPI(account.endpointConfig || defaultEndpoint, 2)
          if (finished) return

          let info
          try {
            info = await api.resource('wallets').get(account.freshAddress)
          } catch (e) {
            const message = e.response
              ? e.response.data.message
              : e.message
            if (message !== 'Wallet not found') {
              throw e
            }
          }
          if (finished) return

          if (!info) {
            // account does not exist, we have nothing to sync
            o.complete()
            return
          }

          const balance = new BigNumber(info.data.data.balance)
          invariant(
            !balance.isNaN() && balance.isFinite(),
            `Ark: invalid balance=${balance.toString()} for address ${account.freshAddress}`,
          )

          o.next(a => ({ ...a, balance }))

          const transactions = await api.resource("transactions").search({
            recipientId: account.freshAddress,
            senderId: account.freshAddress,
            timestamp: {
              from: account.blockHeight
            }
          })

          if (finished) return

          o.next(a => {
            const newOps = transactions.data.data.map(txToOperation(a))
            const operations = mergeOps(a.operations, newOps)
            const [last] = operations
            const pendingOperations = a.pendingOperations.filter(
              o =>
                !operations.some(op => o.hash === op.hash) &&
                last &&
                last.transactionSequenceNumber &&
                o.transactionSequenceNumber &&
                o.transactionSequenceNumber > last.transactionSequenceNumber,
            )
            return {
              ...a,
              operations,
              pendingOperations,
              blockHeight: last.blockHeight,
              lastSyncDate: new Date()
            }
          })

          o.complete()
        } catch (e) {
          o.error(e)
        }
      }

      main()

      return unsubscribe
    }),

  scanAccountsOnDevice: (currency, deviceId) =>
    Observable.create(o => {
      let finished = false
      const unsubscribe = () => {
        finished = true
      }

      async function main() {
        try {
          const api = new ArkAPI('https://api.ark.io', 2)

          const derivationModes = getDerivationModesForCurrency(currency)
          for (const derivationMode of derivationModes) {
            const derivationScheme = getDerivationScheme({ derivationMode, currency })
            const stopAt = isIterableDerivationMode(derivationMode) ? 255 : 1
            for (let index = 0; index < stopAt; index++) {
              if (!derivationModeSupportsIndex(derivationMode, index)) continue
              const freshAddressPath = runDerivationScheme(derivationScheme, currency, {
                account: index,
              })
              const { address } = await getAddress
                .send({
                  derivationMode,
                  currencyId: currency.id,
                  devicePath: deviceId,
                  path: freshAddressPath,
                })
                .toPromise()
              if (finished) return

              const accountId = `arkjs:2:${currency.id}:${address}:${derivationMode}`

              let info
              try {
                info = await api.resource('wallets').get(address)
              } catch (e) {
                const message = e.response
                  ? e.response.data.message
                  : e.message
                if (message !== 'Wallet not found') {
                  throw e
                }
              }

              const freshAddress = address
              
              if (!info) {
                if (derivationMode === '') {
                  o.next({
                    id: accountId,
                    seedIdentifier: freshAddress,
                    derivationMode,
                    name: getNewAccountPlaceholderName({ currency, index, derivationMode }),
                    freshAddress,
                    freshAddressPath,
                    balance: BigNumber(0),
                    blockHeight: 0,
                    index,
                    currency,
                    operations: [],
                    pendingOperations: [],
                    unit: currency.units[0],
                    archived: false,
                    lastSyncDate: new Date(),
                  })
                }
                break
              }

              if (finished) return

              const balance = new BigNumber(info.data.data.balance)
              invariant(
                !balance.isNaN() && balance.isFinite(),
                `Ark: invalid balance=${balance.toString()} for address ${address}`,
              )

              const transactions = await api.resource("wallets").transactions(address)
              if (finished) return

              const account: $Exact<Account> = {
                id: accountId,
                seedIdentifier: freshAddress,
                derivationMode,
                name: getAccountPlaceholderName({ currency, index, derivationMode }),
                freshAddress,
                freshAddressPath,
                balance,
                blockHeight: 0,
                index,
                currency,
                operations: [],
                pendingOperations: [],
                unit: currency.units[0],
                lastSyncDate: new Date(),
              }

              if (transactions) {
                account.operations = transactions.data.data.map(txToOperation(account)).filter(Boolean)
                const lastTransaction = transactions.data.data.slice(-1)[0]
                account.blockHeight = lastTransaction.timestamp.epoch
              }
              o.next(account)
            }
          }
          o.complete()
        } catch (e) {
          o.error(e)
        }
      }

      main()

      return unsubscribe
    }),

  pullMoreOperations: () => Promise.resolve(a => a), // NOT IMPLEMENTED,

  isRecipientValid: (account, recipient) => Promise.resolve(isRecipientValid(account, recipient)),
  getRecipientWarning: (account, recipient) =>
    Promise.resolve(getRecipientWarning(account, recipient)),

  createTransaction: () => ({
    amount: BigNumber(0),
    recipient: '',
    fee: null,
    vendorField: undefined,
  }),

  editTransactionAmount: (account, t, amount) => ({
    ...t,
    amount,
  }),

  getTransactionAmount: (a, t) => t.amount,

  editTransactionRecipient: () => null,

  getTransactionRecipient: (a, t) => t.recipient,

  checkValidTransaction: () => Promise.resolve(false),

  getTotalSpent: (a, t) => Promise.resolve(t.amount.plus(t.fee || 0)),

  getMaxAmount: (a, t) => Promise.resolve(a.balance.minus(t.fee || 0)),

  signAndBroadcast: () =>
    Observable.create(o => {
      o.error(genericError)
    }),
  
  getDefaultEndpointConfig: () => defaultEndpoint
}

export default ArkBridge
