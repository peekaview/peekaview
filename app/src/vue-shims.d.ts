declare module "*.vue" {
  import { defineComponent } from "vue"
  const component: ReturnType<typeof defineComponent>
  export default component
}

declare module '*.png' {
  const content: any
  export default content
}

declare module '*.ico' {
  const content: any
  export default content
}

declare module '*.json' {
  const value: any;
  export default value;
}