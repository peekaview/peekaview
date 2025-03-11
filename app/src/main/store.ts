import ElectronStore from 'electron-store'

interface MacWindowList {
  timestamp: number
  data: string
}

interface StoreSchema {
  uuid: string
  pushToken: string | undefined
  code: string | undefined
  macWindowList: MacWindowList | undefined
}

let store: ElectronStore<StoreSchema> | undefined
export async function getStore(): Promise<any> {
  if (!store) {
    const Store = (await import('electron-store')).default
    store = new Store<StoreSchema>({
      schema: {
        uuid: {
          type: 'string',
        },
        pushToken: {
          type: 'string',
          default: undefined,
        },
        code: {
          type: 'string',
          default: undefined,
        },
        macWindowList: {
          type: 'object',
          default: undefined,
        }
      }
    })
  }
  return store
}