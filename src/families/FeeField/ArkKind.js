// @flow
import logger from 'logger'
import ArkClient from '@arkecosystem/client'
import React, { Component } from 'react'
import styled from 'styled-components'
import { BigNumber } from 'bignumber.js'
import { apiForEndpointConfig, parseAPIValue } from '@ledgerhq/live-common/lib/api/Ark'
import type { Account } from '@ledgerhq/live-common/lib/types'
import { getAccountBridge } from 'bridge'
import { FeeNotLoaded, FeeRequired } from '@ledgerhq/errors'

import InputCurrency from 'components/base/InputCurrency'
import Select from 'components/base/Select'
import Box from 'components/base/Box'
import GenericContainer from './GenericContainer'

type Props = {
  account: Account,
  transaction: *,
  onChange: (*) => void
}

type FeeItem = {
  label: string,
  value: *,
  fee: BigNumber
}

const fallbackTransferFee = BigNumber(1e8)

const valueNameConvention = {
  max: 'High',
  avg: 'Standard',
  min: 'Low'
}

const defaultValue = 'avg'

const customItem = {
  label: 'Custom',
  value: 'custom',
  fee: BigNumber(0),
}

const staticItem = {
  label: 'Static',
  value: 'static',
  fee: fallbackTransferFee,
}

type State = {
  isLoading: boolean,
  isFocused: boolean,
  items: FeeItem[],
  selectedItem: FeeItem,
}

const InputRight = styled(Box).attrs({
  ff: 'Rubik',
  color: 'graphite',
  fontSize: 4,
  justifyContent: 'center',
  pr: 3,
})``

class FeesField extends Component<Props, State> {
  state = {
    items: [staticItem, customItem],
    selectedItem: staticItem,
    isLoading: true,
    isFocused: false,
  }

  componentDidMount() {
    this.onChange(this.state.selectedItem.fee)
    this.sync()
  }

  componentWillUnmount() {
    this.syncId++
    this.isUnmounted = true
  }

  isUnmounted = false
  syncId = 0

  async sync() {
    const { account } = this.props
    const { isFocused } = this.state
    const api = apiForEndpointConfig(ArkClient, account.endpointConfig)
    const syncId = ++this.syncId
    try {
      this.setState({ isLoading: true })
      const items: FeeItem[] = []
      const { data } = await api.resource("node").fees(7)
      if (syncId !== this.syncId) return
      if (this.isUnmounted) return

      const transferFee = data.data.find(fee => fee.type === 0)
      if (!transferFee) return

      for (const key of Object.keys(valueNameConvention)) {
        const fee = BigNumber(transferFee[key])
        if (!fee.isNaN() && !fee.isZero()) {
          items.push({
            label: valueNameConvention[key],
            value: key,
            fee
          })
        }
      }
      
      const selectedItem = items.find(item => item.value === defaultValue)
      if (selectedItem && !isFocused) {
        this.onChange(selectedItem.fee)
      }
      this.setState({ items: [ staticItem, ...items, customItem ], selectedItem })
    } catch (error) {
      logger.error('[ArkKind]', error)
    } finally {
      if (!this.isUnmounted) this.setState({ isLoading: false })
    }
  }

  onSelectChange = (selectedItem: FeeItem) => {
    const { onChange, account, transaction } = this.props
    const bridge = getAccountBridge(account)
    const patch: $Shape<State> = { selectedItem }
    onChange(
      bridge.editTransactionExtra(account, transaction, 'fee', selectedItem.fee),
    )
    this.setState(patch)
  }

  onChange = (value: BigNumber) => {
    const { onChange, account, transaction } = this.props
    const bridge = getAccountBridge(account)
    onChange(bridge.editTransactionExtra(account, transaction, 'fee', value))
  }

  onChangeFocus = (isFocused: boolean) => {
    this.setState({ isFocused })
  }

  render() {
    const { account, transaction } = this.props
    const { isLoading, items, selectedItem } = this.state
    const { units, ticker } = account.currency
    const bridge = getAccountBridge(account)
    const fee = bridge.getTransactionExtra(account, transaction, 'fee')
    return (
      <GenericContainer>
        <Box horizontal flow={5}>
          <Select
            menuPlacement="top"
            width={156}
            options={items}
            value={selectedItem}
            onChange={this.onSelectChange}
          />
          <InputCurrency
            defaultUnit={units[0]}
            units={units}
            containerProps={{ grow: true }}
            onChangeFocus={this.onChangeFocus}
            error={
                !fee && !isLoading
                  ? new FeeNotLoaded()
                  : fee && fee.isZero()
                    ? new FeeRequired()
                    : null
              }
            value={fee}
            onChange={this.onChange}
            renderRight={
              <InputRight>{ticker}</InputRight>
            }
            allowZero
          />
        </Box>
      </GenericContainer>
    )
  }
}

export default FeesField