import ElectronStore from 'electron-store'

interface MacWindowList {
  timestamp: number
  data: string
}

interface StoreSchema {
  code: string | undefined
  macWindowList: MacWindowList | undefined
}

let store: ElectronStore<StoreSchema> | undefined
export async function getStore(): Promise<any> {
  if (!store) {
    const Store = (await import('electron-store')).default
    store = new Store<StoreSchema>({
      schema: {
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