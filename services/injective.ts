import {
  ChainGrpcWasmApi,
  TxRestClient,
  ChainRestBankApi,
  createTransaction,
  ChainRestAuthApi,
  ChainRestTendermintApi,
  BaseAccount,
  createTxRawFromSigResponse,
  createCosmosSignDocFromTransaction,
  TxRaw,
} from '@injectivelabs/sdk-ts'
import {
  DEFAULT_STD_FEE,
  DEFAULT_BLOCK_TIMEOUT_HEIGHT,
  BigNumberInBase,
} from '@injectivelabs/utils'
import { ChainId } from '@injectivelabs/ts-types'
import { Network, getNetworkEndpoints } from '@injectivelabs/networks'
import { MsgExecuteContract, MsgSend } from '@injectivelabs/sdk-ts'
import {
  Coin,
  EncodeObject,
  OfflineDirectSigner,
  OfflineSigner,
} from '@cosmjs/proto-signing'
import { AccountDetails } from '@injectivelabs/sdk-ts/dist/types/auth'
import { base64ToJson } from '../util/base64'
import { StdFee } from '@cosmjs/stargate'

const HIGHER_DEFAULT_GAS_LIMIT = '2000000'

type SimulateResponse = {
  result: {
    data: string
    log: string
    eventsList: {
      type: string
      attributes: {
        key: string
        value: string
      }[]
    }[]
  }
  gasInfo: {
    gasWanted: number
    gasUsed: number
  }
}

class Injective {
  txClient: TxRestClient
  wasmApi: ChainGrpcWasmApi
  bankApi: ChainRestBankApi
  offlineSigner: OfflineSigner & OfflineDirectSigner
  pubKey: string
  baseAccount: BaseAccount
  account: AccountDetails
  chainId: ChainId
  txRaw: TxRaw
  network: Network

  constructor(
    offlineSigner: OfflineSigner & OfflineDirectSigner,
    network: Network = Network.TestnetK8s
  ) {
    const endpoints = getNetworkEndpoints(network)

    this.offlineSigner = offlineSigner
    this.txClient = new TxRestClient(endpoints.rest)
    this.wasmApi = new ChainGrpcWasmApi(endpoints.grpc)
    this.bankApi = new ChainRestBankApi(endpoints.rest)
    this.chainId =
      network === Network.TestnetK8s ? ChainId.Testnet : ChainId.Mainnet
    this.network = network
    this.init()
  }

  async init() {
    const key = await window.keplr.getKey(this.chainId)
    this.pubKey = Buffer.from(key.pubKey).toString('base64')
    const restEndpoint = getNetworkEndpoints(this.network).rest
    const chainRestAuthApi = new ChainRestAuthApi(restEndpoint)
    const [{ address }] = await this.offlineSigner.getAccounts()
    const accountDetailsResponse = await chainRestAuthApi.fetchAccount(address)
    this.baseAccount = BaseAccount.fromRestApi(accountDetailsResponse)
    this.account = this.baseAccount.toAccountDetails()
  }

  getBalance(address: string, searchDenom: string) {
    try {
      return this.bankApi.fetchBalance(address, searchDenom)
    } catch (error) {
      return 0
    }
  }

  getChainId() {
    return this.chainId
  }

  getNetwork() {
    return this.network
  }

  async getTx(txHash: string) {
    return this.txClient.fetchTx(txHash)
  }

  async signAndBroadcast(
    signerAddress: string,
    messages: EncodeObject[],
    fee: StdFee | 'auto' | number,
    memo?: string
  ) {
    try {
      this.txRaw = null
      const { txRaw } = await this.prepair(messages)
      this.txRaw = txRaw
      const signDoc = createCosmosSignDocFromTransaction({
        txRaw: this.txRaw,
        accountNumber: this.baseAccount.accountNumber,
        chainId: this.chainId,
      })

      const directSignResponse = await this.offlineSigner?.signDirect(
        this.account.address,
        signDoc
      )
      const signTxRaw = createTxRawFromSigResponse(directSignResponse)
      this.txRaw = null
      const res = await this.txClient.broadcast(signTxRaw)

      return {
        height: res.height,
        code: res.code,
        transactionHash: res.txHash,
        rawLog: res.rawLog,
      }
    } catch (error) {
      const errorMessage =
        error?.response?.data?.message || error?.message || error?.errorMessage
      throw new Error(errorMessage)
    }
  }

  async prepair(messages: EncodeObject[], send: boolean = true) {
    try {
      await this.init()
      const restEndpoint = getNetworkEndpoints(this.network).rest
      const chainRestTendermintApi = new ChainRestTendermintApi(restEndpoint)
      const latestBlock = await chainRestTendermintApi.fetchLatestBlock()
      const latestHeight = latestBlock.header.height
      const timeoutHeight = new BigNumberInBase(latestHeight).plus(
        DEFAULT_BLOCK_TIMEOUT_HEIGHT
      )
      console.log({ messages })

      // const [[action, msgs]] = Object.entries(messages)

      //     const isLPMessage = action?.includes('provide')

      //     const executeMessageJson = {
      //         action,
      //         msg: msgs as object
      //     }
      //     // Provide LP: Funds isint being handled proper, before we were sending 1 coin, now we are sending it all but getting invalid coins
      //     const params = {
      //         funds: { denom: 'inj', amount: '100000000000000000'},
      //         sender: this.account.address,
      //         contractAddress: 'inj1hyja4uyjktpeh0fxzuw2fmjudr85rk2qxgqkvu',
      //         exec: executeMessageJson,
      //     };

      //     console.log({executeMessageJson, params})

      //     const MessageExecuteContract = MsgExecuteContract.fromJSON(params)

      //     console.log({MessageExecuteContract})

      const encodedExecuteMsg = messages.map((msg, idx) => {
        const { msgT, contract, funds } = msg?.value || {}
        const msgString = Buffer.from(msg?.value?.msg).toString('utf8')
        const jsonMessage = JSON.parse(msgString)

        const [[action, msgs]] = Object.entries(jsonMessage)

        const isLPMessage = action?.includes('provide')

        const executeMessageJson = {
          action,
          msg: msgs as object,
        }
        console.log({ executeMessageJson })
        // Provide LP: Funds isint being handled proper, before we were sending 1 coin, now we are sending it all but getting invalid coins
        const params = {
          funds: isLPMessage ? funds : funds?.[0],
          sender: this.account.address,
          contractAddress: contract,
          exec: executeMessageJson,
        }

        const MessageExecuteContract = MsgExecuteContract.fromJSON(params)
        return MessageExecuteContract
      })
      // Create the transaction for signing and broadcasting
      return createTransaction({
        pubKey: this.pubKey,
        chainId: this.chainId,
        fee: {
          ...DEFAULT_STD_FEE,
          gas: HIGHER_DEFAULT_GAS_LIMIT || DEFAULT_STD_FEE.gas,
        },
        message: encodedExecuteMsg.map((msg) => msg.toDirectSign()),
        sequence: this.baseAccount.sequence,
        timeoutHeight: timeoutHeight.toNumber(),
        accountNumber: this.baseAccount.accountNumber,
      })
    } catch (error) {
      const errorMessage =
        error?.response?.data?.message || error?.message || error?.errorMessage
      throw new Error(errorMessage)
    }
  }

  async simulate(
    signerAddress: string,
    messages: EncodeObject[],
    memo: string | undefined
  ) {
    try {
      this.txRaw = null
      const { txRaw } = await this.prepair(messages)
      this.txRaw = txRaw
      txRaw.addSignatures('')
      return await this.txClient
        .simulate(txRaw)
        .then(({ gasInfo }: SimulateResponse) => gasInfo.gasUsed)
    } catch (error) {
      console.log({ error })
      const errorMessage =
        error?.response?.data?.message || error?.message || error?.errorMessage
      throw new Error(errorMessage)
    }
  }

  async queryContractSmart(address: string, queryMsg: Record<string, unknown>) {
    return this.wasmApi
      .fetchSmartContractState(
        address,
        Buffer.from(JSON.stringify(queryMsg)).toString('base64')
      )
      .then(({ data }) => base64ToJson(data as string))
  }

  async getTxRawFromJson(
    message: Record<string, unknown>,
    contractAddress,
    funds
  ) {
    await this.init()
    const restEndpoint = getNetworkEndpoints(this.network).rest
    const chainRestTendermintApi = new ChainRestTendermintApi(restEndpoint)
    const latestBlock = await chainRestTendermintApi.fetchLatestBlock()
    const latestHeight = latestBlock.header.height
    const timeoutHeight = new BigNumberInBase(latestHeight).plus(
      DEFAULT_BLOCK_TIMEOUT_HEIGHT
    )
    const [[action, msgs]] = Object.entries(message)

    const executeMessageJson = {
      action,
      msg: msgs as object,
    }

    const params = {
      funds,
      sender: this.account.address,
      contractAddress,
      exec: executeMessageJson,
    }

    const MessageExecuteContract = MsgExecuteContract.fromJSON(params)

    return createTransaction({
      pubKey: this.pubKey,
      chainId: this.chainId,
      fee: {
        ...DEFAULT_STD_FEE,
        gas: HIGHER_DEFAULT_GAS_LIMIT || DEFAULT_STD_FEE.gas,
      },
      message: [MessageExecuteContract].map((msg) => msg.toDirectSign()),
      sequence: this.baseAccount.sequence,
      timeoutHeight: timeoutHeight.toNumber(),
      accountNumber: this.baseAccount.accountNumber,
    })
  }

  async execute(
    senderAddress: string,
    contractAddress: string,
    msg: Record<string, unknown>,
    funds?: Coin[]
  ) {
    if (!this.txRaw) {
      const { txRaw } = await this.getTxRawFromJson(msg, contractAddress, [])
      this.txRaw = txRaw
    }

    try {
      const signDoc = createCosmosSignDocFromTransaction({
        txRaw: this.txRaw,
        accountNumber: this.baseAccount.accountNumber,
        chainId: this.chainId,
      })

      const directSignResponse = await this.offlineSigner?.signDirect(
        this.account.address,
        signDoc
      )
      const signTxRaw = createTxRawFromSigResponse(directSignResponse)
      this.txRaw = null
      return this.txClient.broadcast(signTxRaw).then((result) => {
        console.log({ result })
        if (!!result.code) {
          throw new Error(
            `Error when broadcasting tx ${result.txHash} at height ${result.height}. Code: ${result.code}; Raw log: ${result.rawLog}`
          )
        } else {
          return result
        }
      })
    } catch (error) {
      const errorMessage =
        error?.response?.data?.message || error?.message || error?.errorMessage
      throw new Error(errorMessage)
    }
  }
}

export default Injective
