import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http'
import { Injectable } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { BehaviorSubject, of } from 'rxjs'
import { catchError, tap } from 'rxjs/operators'

import { environment } from '~environments'

import { ErrorDialogComponent } from '~app/dialog/error/error.component'

import { OracleAnnouncementsResponse, OracleExplorerResponse, OracleNameResponse } from '~type/oracle-explorer-types'
import { MessageType, OracleAnnouncement } from '~type/oracle-server-types'
import { getProxyErrorHandler } from '~type/proxy-server-types'

import { getMessageBody } from '~util/oracle-server-util'

import { TorService } from './tor.service'
import { MessageService } from './message.service'


// Host replacement header for proxy
const HOST_OVERRIDE_HEADER = 'host-override'

// LocalStorage Keys
const ORACLE_NAME_KEY = 'ORACLE_NAME' // Holds values like 'My Oracle'
const ORACLE_EXPLORER_VALUE_KEY = 'ORACLE_EXPLORER_VALUE' // Holds values like 'test'

export interface OracleExplorer { value: string; name: string; host: string }
export const ORACLE_EXPLORERS: OracleExplorer[] = [
  { value: 'test', name: 'Suredbits Test Oracle Explorer', host: 'test.oracle.suredbits.com' },
  { value: 'prod', name: 'Suredbits Production Oracle Explorer', host: 'oracle.suredbits.com' },
]
const DEFAULT_ORACLE_EXPLORER_VALUE = 'test'

@Injectable({ providedIn: 'root' })
export class OracleExplorerService {

  private get url() {
    return (this.torService.useTor ? environment.torApi : '') + environment.oracleExplorerApi
  }

  readonly oracleName: BehaviorSubject<string> = new BehaviorSubject('')
  readonly serverOracleName: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false)

  oracleExplorer: BehaviorSubject<OracleExplorer>
  setOracleExplorer(oe: OracleExplorer) {
    this.oracleExplorer.next(oe)
    localStorage.setItem(ORACLE_EXPLORER_VALUE_KEY, oe.value)
  }
  
  constructor(private http: HttpClient, private messageService: MessageService, private torService: TorService, private dialog: MatDialog) {
    const oracleValue = localStorage.getItem(ORACLE_EXPLORER_VALUE_KEY) || DEFAULT_ORACLE_EXPLORER_VALUE
    const oracle = ORACLE_EXPLORERS.find(o => o.value === oracleValue)
    this.oracleExplorer = new BehaviorSubject(oracle ? oracle : ORACLE_EXPLORERS[0])
  }

  private getHeaders() {
    const headers = new HttpHeaders()
      .set(HOST_OVERRIDE_HEADER, this.oracleExplorer.value.host)
    return { headers }
  }

  private errorHandler = getProxyErrorHandler('oracleExplorer', (message: string) => {
    const dialog = this.dialog.open(ErrorDialogComponent, {
      data: {
        title: 'dialog.oracleExplorerError.title',
        content: message,
      }
    })
  }).bind(this)

  /**
   * @see https://gist.github.com/Christewart/a9e55d9ba582ac9a5ceffa96db9d7e1f#list-all-events
   * @returns OracleAnnouncementsResponse[]
   */
  listAnnouncements() {
    return this.http.get<OracleExplorerResponse<OracleAnnouncementsResponse[]>>(this.url + '/announcements', 
      this.getHeaders()).pipe(catchError(this.errorHandler))
  }

  /**
   * @see https://gist.github.com/Christewart/a9e55d9ba582ac9a5ceffa96db9d7e1f#get-event
   * @returns OracleAnnouncementsResponse
   */
  getAnnouncement(announcementHash: string) {
    return this.http.get<OracleExplorerResponse<OracleAnnouncementsResponse>>(this.url + `/announcements/${announcementHash}`,
      this.getHeaders()).pipe(catchError(this.errorHandler))
  }

  /**
   * @see https://gist.github.com/Christewart/a9e55d9ba582ac9a5ceffa96db9d7e1f#create-an-event
   * @returns announcementTLVsha256
   */
  createAnnouncement(a: OracleAnnouncement) {
    // Java does get then send to see if oracle has it already
    if (!this.oracleName.value) {
      throw(Error('Oracle Name must be set to create announcements'))
    }
    
    // This sets application/x-www-form-urlencoded when sent
    const body = new HttpParams()
      .set('oracleAnnouncementV0', a.announcementTLV)
      .set('description', a.eventName)
      .set('oracleName', this.oracleName.value)
    // TODO : Could allow user to enter URI
    
    return this.http.post<OracleExplorerResponse<string>>(this.url + '/announcements', body, this.getHeaders())
      .pipe(catchError(this.errorHandler))
  }

  /**
   * @param announcementHash 
   * @param attestations 
   * @see https://gist.github.com/Christewart/a9e55d9ba582ac9a5ceffa96db9d7e1f#create-an-events-attestation
   * @returns OracleAnnouncementsResponse
   */
  createAttestations(a: OracleAnnouncement) {
    if (!this.oracleName.value) {
      throw(Error('Oracle Name must be set to create attestations'))
    }

    const body = new HttpParams()
      .set('attestations', a.attestations)
    return this.http.post<OracleExplorerResponse<OracleAnnouncementsResponse>>(this.url + `/announcements/${a.announcementTLVsha256}/attestations`, body, this.getHeaders())
      .pipe(catchError(this.errorHandler))
  }

  getOracleName(pubkey: string) {
    return this.http.get<OracleExplorerResponse<OracleNameResponse>>(this.url + `/oracle/${pubkey}`)
      // This eats the 404 error that will occur if the pubkey does not exist and returns null
      .pipe(catchError((error: any) => of(null)))
  }

  getLocalOracleName(pubkey: string) {
    return this.getOracleName(pubkey).pipe(tap(result => {

      let osOracleName: string // oracleName according to oracleServer
      this.messageService.sendMessage(getMessageBody(MessageType.getoraclename)).subscribe(result2 => {
        if (result2 && result2.result) {
          osOracleName = result2.result
          console.warn('oracleServer OracleName:', osOracleName)
        }

        const lsOracleName = localStorage.getItem(ORACLE_NAME_KEY); // historical
        if (result && result.result) { // OracleExplorer.getOracleName()
          this.oracleName.next(result.result.oracleName)
          this.serverOracleName.next(true)
          if (result.result.oracleName && lsOracleName && lsOracleName !== result.result.oracleName) {
            console.warn('lsOracleName:', lsOracleName)
            console.error('local oracleName and oracle explorer oracleName do not match!')
            // Force server oracleName
            // localStorage.setItem(ORACLE_NAME_KEY, result.result.oracleName)
            this.setOracleName(result.result.oracleName, true)
          } else if (result.result.oracleName && osOracleName !== result.result.oracleName) {
            console.error('local oracleServer oracleName and oracle explorer oracleName do not match!')
            // Force server oracleName
            this.setOracleName(result.result.oracleName, true)
          }
        } else if (osOracleName) {
          this.oracleName.next(osOracleName)
          this.serverOracleName.next(false)
        } else if (lsOracleName) {
          // Use localStorage oracleName if it's set, but hasn't been used on the Oracle Explorer yet
          this.oracleName.next(lsOracleName)
          this.setOracleName(lsOracleName, true)
          this.serverOracleName.next(false)
        } else {
          console.warn('no oracleName found')
          this.oracleName.next('')
          this.serverOracleName.next(false)
        }
      })
    }))
  }

  setOracleName(name: string, force = false) {
    if (this.serverOracleName.value && !force) {
      console.error('cannot change oracleName once set on Oracle Explorer')
      return
    }
    if (name) {
      // localStorage.setItem(ORACLE_NAME_KEY, name) // historically used as oracleName, now databased in oracleServer
      localStorage.removeItem(ORACLE_NAME_KEY) // ignore this from now on
      this.messageService.sendMessage(getMessageBody(MessageType.setoraclename, [name])).subscribe(_ => {
        this.oracleName.next(name)
      })
    }
  }

  /** GUI Util */

  openAnnouncementTab(a: OracleAnnouncement) {
    const url = `https://${this.oracleExplorer.value.host}/announcement/${a.announcementTLVsha256}`
    window.open(url, '_blank')
  }
  
}
