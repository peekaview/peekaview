import { JSONSchema4 } from 'json-schema'
import { ContactData, InviteCodeData } from './interface'

export interface StorageSchema {
  locale: string
  uuid: string
  name: string | undefined
  pushToken: string | undefined
  code: string | undefined
  recentContacts: Record<string, ContactData>
  lastViewActive: number | undefined
  inviteCodeCache: Record<string, InviteCodeData>
  macWindowList: {
    timestamp: number
    data: string
  } | undefined
}

export const schema: JSONSchema4 = {
  locale: {
    type: 'string',
    default: undefined,
  },
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
  inviteCodeCache: {
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