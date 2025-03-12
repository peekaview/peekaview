import ElectronStore from 'electron-store'
import { StorageSchema } from '../interface'

type Store<Schema extends Object> = {
  get<K extends keyof Schema>(key: K): Schema[K]
  set<K extends keyof Schema>(key: K, value: Schema[K]): void
  delete<K extends keyof Schema>(key: K): void
  has<K extends keyof Schema>(key: K): boolean
  onDidChange<K extends keyof Schema>(key: K, callback: () => void): void
}

let store: ElectronStore<StorageSchema> | undefined
export async function getStore(): Promise<Store<StorageSchema>> {
  if (!store) {
    const Store = (await import('electron-store')).default
    store = new Store<StorageSchema>({
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
  return store as unknown as Store<StorageSchema>
}