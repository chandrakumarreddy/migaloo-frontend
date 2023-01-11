import { GasPrice } from '@cosmjs/stargate'
import { useConnectedWallet, useWallet } from '@terra-money/wallet-provider'
import { useChainInfo } from 'hooks/useChainInfo'
import { useRecoilState, useResetRecoilState } from 'recoil'
import { walletState, WalletStatusType } from 'state/atoms/walletAtoms'
import { OfflineSigningWallet } from 'util/wallet-adapters'

import { clearWalletState } from '../util/cleatWalletState'

export default function useConnectLeap() {
  const [currentWalletState, setCurrentWalletState] =
    useRecoilState(walletState)
  const reset = useResetRecoilState(walletState)
  const [chainInfo] = useChainInfo(currentWalletState.chainId)
  const connectedWallet = useConnectedWallet()
  const { disconnect } = useWallet()

  const connectLeap = async () => {
    if (connectedWallet) {
      disconnect()
    }
    if (window && !window.leap) {
      reset()
      clearWalletState('leap')
      return
    }

    try {
      if (chainInfo !== undefined) {
        await window.leap.experimentalSuggestChain(chainInfo)
        await window.leap.enable(currentWalletState.chainId)
        const offlineSigner = await window.leap.getOfflineSigner(
          currentWalletState.chainId
        )

        const wasmChainClient = await OfflineSigningWallet.connectWithSigner(
          currentWalletState.chainId,
          chainInfo.rpc,
          offlineSigner,
          currentWalletState.network,
          {
            gasPrice: GasPrice.fromString(
              `${chainInfo?.gasPriceStep?.low}${chainInfo?.feeCurrencies?.[0].coinMinimalDenom}`
            ),
          }
        )
        const [{ address }] = await offlineSigner.getAccounts()
        const key = await window.leap.getKey(currentWalletState.chainId)
        /* successfully update the wallet state */
        setCurrentWalletState({
          key,
          address: address,
          client: wasmChainClient,
          chainId: currentWalletState.chainId,
          network: currentWalletState.network,
          status: WalletStatusType.connected,
          activeWallet: 'leap',
        })
      }
    } catch (e) {
      console.log(e)
      // throw e
    }
  }

  const setLeapAndConnect = () => {
    setCurrentWalletState({ ...currentWalletState, activeWallet: 'leap' })
    localStorage.removeItem('__terra_extension_router_session__')
    connectLeap()
  }

  return { connectLeap, setLeapAndConnect }
}