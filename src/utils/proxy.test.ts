import { describe, it, expect } from 'bun:test'
import {
  getProxyUrl,
  getSocks5ProxyUrl,
  getNoProxy,
  shouldBypassProxy,
} from './proxy.ts'

describe('proxy utils', () => {
  describe('getProxyUrl', () => {
    it('should return undefined when no proxy configured', () => {
      const env = {}
      expect(getProxyUrl(env)).toBeUndefined()
    })

    it('should return https_proxy when set', () => {
      const env = { https_proxy: 'https://proxy.com:443' }
      expect(getProxyUrl(env)).toBe('https://proxy.com:443')
    })

    it('should fall back to HTTP_PROXY', () => {
      const env = { HTTP_PROXY: 'http://proxy.com:8080' }
      expect(getProxyUrl(env)).toBe('http://proxy.com:8080')
    })

    it('should prioritize HTTPS_PROXY for https requests', () => {
      const env = {
        http_proxy: 'http://http.proxy.com:8080',
        https_proxy: 'http://https.proxy.com:8443',
      }
      expect(getProxyUrl(env)).toBe('http://https.proxy.com:8443')
    })
  })

  describe('getSocks5ProxyUrl', () => {
    it('should return undefined when no socks proxy configured', () => {
      const env = {}
      expect(getSocks5ProxyUrl(env)).toBeUndefined()
    })

    it('should return socks_proxy when set', () => {
      const env = { socks_proxy: 'socks5://socks.example.com:1080' }
      expect(getSocks5ProxyUrl(env)).toBe('socks5://socks.example.com:1080')
    })

    it('should fall back to SOCKS_PROXY', () => {
      const env = { SOCKS_PROXY: 'socks5://socks.example.com:1080' }
      expect(getSocks5ProxyUrl(env)).toBe('socks5://socks.example.com:1080')
    })

    it('should fall back to socks5_proxy', () => {
      const env = { socks5_proxy: 'socks5://socks.example.com:1080' }
      expect(getSocks5ProxyUrl(env)).toBe('socks5://socks.example.com:1080')
    })
  })

  describe('getNoProxy', () => {
    it('should return empty array when no no_proxy set', () => {
      const env = {}
      expect(getNoProxy(env)).toEqual([])
    })

    it('should parse no_proxy env var', () => {
      const env = { no_proxy: 'localhost, 127.0.0.1, .internal.com' }
      expect(getNoProxy(env)).toEqual(['localhost', '127.0.0.1', '.internal.com'])
    })

    it('should handle whitespace in no_proxy', () => {
      const env = { NO_PROXY: ' localhost , 127.0.0.1 ' }
      expect(getNoProxy(env)).toEqual(['localhost', '127.0.0.1'])
    })

    it('should split by comma and whitespace', () => {
      const env = { no_proxy: 'localhost 127.0.0.1,.example.com, .another.com' }
      expect(getNoProxy(env)).toEqual(['localhost', '127.0.0.1', '.example.com', '.another.com'])
    })
  })

  describe('shouldBypassProxy', () => {
    it('should return false when no_proxy is empty', () => {
      expect(shouldBypassProxy('https://api.anthropic.com', [])).toBe(false)
    })

    it('should return true for wildcard', () => {
      expect(shouldBypassProxy('https://any.site.com', ['*'])).toBe(true)
    })

    it('should bypass localhost', () => {
      expect(shouldBypassProxy('https://localhost:8080', ['localhost'])).toBe(true)
    })

    it('should bypass exact IP match', () => {
      expect(shouldBypassProxy('https://127.0.0.1:443', ['127.0.0.1'])).toBe(true)
    })

    it('should bypass domain suffix with leading dot', () => {
      expect(shouldBypassProxy('https://api.internal.com', ['.internal.com'])).toBe(true)
    })

    it('should bypass exact domain match with leading dot', () => {
      expect(shouldBypassProxy('https://internal.com', ['.internal.com'])).toBe(true)
    })

    it('should not bypass unrelated domains', () => {
      expect(shouldBypassProxy('https://api.example.com', ['localhost', '.internal.com'])).toBe(false)
    })

    it('should handle port in no_proxy entry', () => {
      expect(shouldBypassProxy('https://api.example.com:443', ['api.example.com:443'])).toBe(true)
    })

    it('should not bypass when port does not match', () => {
      expect(shouldBypassProxy('https://api.example.com:80', ['api.example.com:443'])).toBe(false)
    })

    it('should handle case insensitivity', () => {
      expect(shouldBypassProxy('https://API.EXAMPLE.COM', ['api.example.com'])).toBe(true)
    })
  })
})
