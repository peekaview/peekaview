import ElectronStore from 'electron-store'

interface MacWindowList {
  timestamp: number
  data: string
}

interface StoreSchema {
  uuid: string
  name: string | undefined
  pushToken: string | undefined
  code: string | undefined
  recentContacts: string | undefined
  lastViewActive: string | undefined
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
        name: {
          type: 'string',
          default: undefined,
        },
        pushToken: {
          type: 'string',
          default: undefined,
        },
        code: {
          type: 'string',
          default: undefined,
        },
        recentContacts: {
          type: 'string',
          default: '{}',
        },
        lastViewActive: {
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