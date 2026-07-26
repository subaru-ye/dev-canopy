import type { DevCanopyApi } from '../../shared/types'

declare global {
  interface Window {
    devcanopy: DevCanopyApi
  }
}

export {}
