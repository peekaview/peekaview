import { computed, reactive, ref } from "vue"

export function useKeyListeners(send: (key: string) => void) {
  const _control = ref(false)
  const _alt = ref(false)
  const _shift = ref(false)
  const _space = ref(false)
  const _skip = ref(false)

  // readonly
  const control = computed(() => _control.value)
  const alt = computed(() => _alt.value)
  const shift = computed(() => _shift.value)
  const space = computed(() => _space.value)
  const skip = computed(() => _skip.value)

  function onKeyUp(e: KeyboardEvent) {
    if (e.key == 'Control' || e.key == 'Meta') {
      setTimeout(() => {
        _control.value = false
      }, 100)
    }
    if (e.key == 'Shift') {
      _shift.value = false
    }
    if (e.key == " " || e.code == "Space" || e.keyCode == 32) {
      setTimeout(() => {
        _space.value = false
      }, 100)
    }
    if (e.key == 'Alt' || e.key == 'AltGraph') {
      setTimeout(() => {
        _alt.value = false
      }, 100)
    }

    e.preventDefault()
    return false
  }

  function onKeyDown(e: KeyboardEvent) {
    console.log(e.keyCode)

    _skip.value = false
    let keyToSend = e.key
    if (e.key == " " || e.code == "Space" || e.keyCode == 32) {
      _space.value = true
    }
    if (e.key == 'Shift') {
      _shift.value = true
    }
    if (e.key == 'Control' || e.key == 'Meta') {
      _control.value = true
    }
    if (e.key == 'Alt' || e.key == 'AltGraph') {
      _alt.value = true
    }
    if (e.key == 'Alt' || e.key == 'AltGraph' || e.key == 'Shift' || e.key == 'CapsLock') {
      _skip.value = true
    }
    if (_control.value && (e.key == 'Control' || e.key == 'Meta' || e.key == 'v' || e.key == 'c' || e.key == 'x')) {
      _skip.value = true
    }
    if (_control.value && e.key != 'v' && e.key != 'c' && e.key != 'x' && (e.key.length === 1 && e.key.toLowerCase().match(/[a-z]/i) || e.key == 'Enter')) {
      keyToSend = '_____strg+' + e.key.toLowerCase()
    }

    // Special keys ~,+,^,`,´ and how to detect them
    if (_alt.value && e.keyCode == 78) {
      _skip.value = false
      keyToSend = '~'
    }
    if (e.keyCode === 187) {  // Both ´ and + share keyCode 187
      if (e.code === 'Equal') {  // Physical key is always 'Equal'
        if (e.key === 'Dead') {
          // This is ´ (acute accent)
          _skip.value = false
          if (_shift.value) {
            keyToSend = '`'
          } else {
            keyToSend = '´'
          }
        } else if (e.key === '+') {
          // This is the + key
          _skip.value = false
          keyToSend = '+'
        }
      }
    }
    if (e.keyCode == 192) {
      _skip.value = false
      if (_shift.value) {
        keyToSend = '°'
      }
      else {
        keyToSend = '^'
      }
    }
    
    if (!_skip) {
      console.log(keyToSend)

      send(keyToSend)
      e.preventDefault()
    }
  }

  return { pressed: reactive({ control, alt, shift, space, skip }), onKeyDown, onKeyUp }
}

export function useMouseListeners() {

  
  return { onMouseDown, onMouseUp }
}
