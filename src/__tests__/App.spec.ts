import { describe, it, expect } from 'vitest'

import { mount } from '@vue/test-utils'
import App from '../App.vue'

describe('App', () => {
  it('mounts without router by stubbing RouterView', () => {
    // App uses <RouterView />. In unit tests we can stub it to avoid
    // installing the full vue-router instance.
    const wrapper = mount(App, {
      global: {
        stubs: {
          RouterView: {
            template: '<div>router-stub</div>',
          },
        },
      },
    })

    expect(wrapper.exists()).toBe(true)
    expect(wrapper.html()).toContain('router-stub')
  })
})
