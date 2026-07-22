import type { DevDeskApi } from '../../shared/types'

declare global {
  interface Window {
    devdesk: DevDeskApi
  }
}

export {}
