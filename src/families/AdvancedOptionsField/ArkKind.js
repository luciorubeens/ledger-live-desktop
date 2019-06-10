// @flow
import React, { Component } from 'react'
import styled from 'styled-components'
import { translate } from 'react-i18next'
import type { Account } from '@ledgerhq/live-common/lib/types'
import { getAccountBridge } from 'bridge'

import Box from 'components/base/Box'
import Input from 'components/base/Input'
import Label from 'components/base/Label'

type Props = {
  onChange: (*) => void,
  transaction: *,
  account: Account,
  t: *,
}

const InputRight = styled(Box).attrs({
  ff: 'Rubik',
  color: 'graphite',
  fontSize: 4,
  justifyContent: 'center',
  pr: 3,
})``

const maxLength = 255

class AdvancedOptions extends Component<Props> {
  onChange = str => {
    const { account, transaction, onChange } = this.props
    const bridge = getAccountBridge(account)
    const vendorField = str.slice(0, maxLength)
    
    onChange(bridge.editTransactionExtra(account, transaction, 'vendorField', vendorField))
  }

  render() {
    const { account, transaction, t } = this.props
    const bridge = getAccountBridge(account)
    const vendorField = bridge.getTransactionExtra(account, transaction, 'vendorField') || ''

    return (
      <Box vertical flow={5}>
        <Box grow>
          <Label>
            <span>{t('send.steps.amount.arkVendorField')}</span>
          </Label>
          <Input
            value={vendorField}
            onChange={this.onChange}
            renderRight={
              <InputRight>{`${vendorField.length}/${maxLength}`}</InputRight>
            }
          />
        </Box>
      </Box>
    )
  }
}

export default translate()(AdvancedOptions)
