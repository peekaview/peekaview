import { JSONSchema4 } from 'json-schema'
import { ContactData } from './interface'

export interface StorageSchema {
  uuid: string
  name: string | undefined
  pushToken: string | undefined
  code: string | undefined
  recentContacts: Record<string, ContactData>
  lastViewActive: number | undefined
  viewCodeCache: Record<string, string>
  macWindowList: {
    timestamp: number
    data: string
  } | undefined
}

export const schema: JSONSchema4 = {
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
    type: 'object',
    default: {},
  },
  lastViewActive: {
    type: 'number',
    default: undefined,
  },
  viewCodeCache: {
    type: 'object',
    default: {},
  },
  macWindowList: {
    type: 'object',
    properties: {
      timestamp: {
        type: 'number',
      },
      data: {
        type: 'string',
      },
    },
    default: undefined,
  }
}