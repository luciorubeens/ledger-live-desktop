// @flow
import Ark from '@arkecosystem/ledger-transport'
import * as ArkCrypto from '@arkecosystem/crypto'
import type Transport from '@ledgerhq/hw-transport'

export default async (transport: Transport<*>, currencyId: string, path: string, tx: *) => {
  const ark = new Ark(transport)

  const rawTxHex = ArkCrypto.TransactionSerializer.getBytes(tx, {
      excludeSignature: true,
      excludeSecondSignature: true
    }).toString('hex')

  const sign = await ark.signTransaction(path, rawTxHex)

  tx.signature = sign.signature
  tx.id = ArkCrypto.crypto.getId(tx)
  
  return tx
}
