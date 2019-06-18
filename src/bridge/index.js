// @flow
import type { CryptoCurrency, Account } from '@ledgerhq/live-common/lib/types'
import type { CurrencyBridge, AccountBridge } from '@ledgerhq/live-common/lib/bridge/types'
import {
  makeMockCurrencyBridge,
  makeMockAccountBridge,
} from '@ledgerhq/live-common/lib/bridge/makeMockBridge'
import { getEnv } from '@ledgerhq/live-common/lib/env'
import { createCustomErrorClass } from '@ledgerhq/errors'
import { decodeAccountId } from '@ledgerhq/live-common/lib/account'
import * as LibcoreBridge from './LibcoreBridge'
import * as RippleJSBridge from './RippleJSBridge'
import * as EthereumJSBridge from './EthereumJSBridge'
import * as ArkJSBridge from './ArkJSBridge'

// TODO as soon as it's in @ledgerhq/errors we can import it
const CurrencyNotSupported = createCustomErrorClass('CurrencyNotSupported')

const mockCurrencyBridge = makeMockCurrencyBridge()
const mockAccountBridge = makeMockAccountBridge()

export const getCurrencyBridge = (currency: CryptoCurrency): CurrencyBridge => {
  if (getEnv('MOCK')) return mockCurrencyBridge
  switch (currency.family) {
    case 'ripple':
      return RippleJSBridge.currencyBridge
    case 'ethereum':
      if (getEnv('EXPERIMENTAL_LIBCORE')) {
        return LibcoreBridge.currencyBridge
      }
      return EthereumJSBridge.currencyBridge
    case 'bitcoin':
      return LibcoreBridge.currencyBridge
    case 'ark':
      return ArkJSBridge.currencyBridge
    default:
      return mockCurrencyBridge // fallback mock until we implement it all!
  }
}

export const getAccountBridge = (account: Account): AccountBridge<any> => {
  const { type } = decodeAccountId(account.id)
  if (type === 'mock') return mockAccountBridge
  if (type === 'libcore') return LibcoreBridge.accountBridge
  switch (account.currency.family) {
    case 'ripple':
      return RippleJSBridge.accountBridge
    case 'ethereum':
      return EthereumJSBridge.accountBridge
    case 'ark':
      return ArkJSBridge.accountBridge
    default:
      throw new CurrencyNotSupported('currency not supported', {
        currencyName: account.currency.name,
      })
  }
}
