import { Injectable } from "@angular/core"
import { BehaviorSubject } from "rxjs"
import { BuildConfig } from "~type/proxy-server-types"

import { Balances, BlockchainMessageType, ContractInfo, CoreMessageType, DLCContract, DLCWalletAccounting, FundedAddress, GetInfoResponse, ServerResponse, ServerVersion, WalletMessageType } from "~type/wallet-server-types"
import { getMessageBody } from "~util/wallet-server-util"

import { MessageService } from "./message.service"


@Injectable({ providedIn: 'root' })
export class WalletStateService {

  serverVersion: string
  buildConfig: BuildConfig

  info: GetInfoResponse
  balances: Balances
  fundedAddresses: FundedAddress[]
  dlcWalletAccounting: DLCWalletAccounting
  feeEstimate: string
  dlcs: BehaviorSubject<DLCContract[]> = new BehaviorSubject<DLCContract[]>([])
  contractInfos: BehaviorSubject<{ [dlcId: string]: ContractInfo }> = new BehaviorSubject<{ [dlcId: string]: ContractInfo }>({})

  constructor(private messageService: MessageService) {
    this.messageService.getServerVersion().subscribe(r => {
      if (r.result) {
        this.serverVersion = r.result.version;
      }
    })
    this.messageService.buildConfig().subscribe(result => {
      if (result) {
        result.dateString = new Date(result.committedOn * 1000).toLocaleDateString()
        this.buildConfig = result
      }
    })
    this.messageService.sendMessage(getMessageBody(BlockchainMessageType.getinfo)).subscribe(r => {
      if (r.result) {
        this.info = r.result
      }
    })
    this.messageService.sendMessage(getMessageBody(WalletMessageType.getbalances, [true])).subscribe(r => {
      if (r.result) {
        this.balances = r.result
      }
    })
    this.messageService.sendMessage(getMessageBody(WalletMessageType.getfundedaddresses)).subscribe(r => {
      if (r.result) {
        this.fundedAddresses = r.result
      }
    })
    this.messageService.sendMessage(getMessageBody(WalletMessageType.getdlcwalletaccounting)).subscribe(r => {
      if (r.result) {
        this.dlcWalletAccounting = r.result
      }
    })
    this.messageService.sendMessage(getMessageBody(WalletMessageType.estimatefee)).subscribe(r => {
      if (r.result) {
        this.feeEstimate = r.result
      }
    })
    this.refreshDLCStates()
  }

  refreshDLCStates() {
    this.messageService.sendMessage(getMessageBody(WalletMessageType.getdlcs)).subscribe(r => {
      if (r.result) {
        this.dlcs.next(r.result)
        // Decode all ContractInfos
        for (const dlc of <DLCContract[]>r.result) {
          this.messageService.sendMessage(getMessageBody(CoreMessageType.decodecontractinfo, [dlc.contractInfo])).subscribe((r: ServerResponse<ContractInfo>) => {
            console.warn('decodecontractinfo', r)
            if (r.result) {
              const ci = this.contractInfos.value
              ci[dlc.dlcId] = r.result
            }
          })
        }
      }
    })
  }

}
