// @aws-sdk/credential-provider-node and @smithy/node-http-handler are imported
// dynamically in getAWSClientProxyConfig() to defer ~929KB of AWS SDK.
// undici is lazy-required inside getProxyAgent/configureGlobalAgents to defer
// ~1.5MB when no HTTPS_PROXY/mTLS env vars are set (the common case).
import axios, { type AxiosInstance } from 'axios'
import type { LookupOptions } from 'dns'
import type { Agent } from 'http'
import { HttpsProxyAgent, type HttpsProxyAgentOptions } from 'https-proxy-agent'
import memoize from 'lodash-es/memoize.js'
import type * as undici from 'undici'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getMTLSAgent,
  getMTLSConfig,
  getTLSFetchOptions,
  type TLSConfig,
} from './mtls.js'

let keepAliveDisabled = false

export function disableKeepAlive(): void {
  keepAliveDisabled = true
}

export function _resetKeepAliveForTesting(): void {
  keepAliveDisabled = false
}

export function getAddressFamily(options: LookupOptions): 0 | 4 | 6 {
  switch (options.family) {
    case 0:
    case 4:
    case 6:
      return options.family
    case 'IPv6':
      return 6
    case 'IPv4':
    case undefined:
      return 4
    default:
      throw new Error(`Unsupported address family: ${options.family}`)
  }
}

type EnvLike = Record<string, string | undefined>

export type ProxyType = 'http' | 'https' | 'socks5'

export interface ProxyConfig {
  http?: string
  https?: string
  socks5?: string
  no_proxy?: string[]
}

function getProxyConfigFromEnv(env: EnvLike = process.env): ProxyConfig {
  return {
    http: env.http_proxy || env.HTTP_PROXY || env.https_proxy || env.HTTPS_PROXY,
    https: env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY,
    socks5: env.socks_proxy || env.SOCKS_PROXY || env.socks5_proxy || env.SOCKS5_PROXY,
    no_proxy: (env.no_proxy || env.NO_PROXY || '')
      .split(/[,\s]+/)
      .filter(Boolean),
  }
}

function getProxyConfigFromFile(): ProxyConfig | undefined {
  try {
    const configPath = process.env.CLAUDE_CODE_MODEL_CONFIG || process.env.CLAUDE_CODE_PROXY_CONFIG
    if (!configPath) return undefined

    const fs = require('fs')
    const content = fs.readFileSync(configPath, 'utf8')
    const config = JSON.parse(content)

    return config.proxy
  } catch {
    return undefined
  }
}

export function getProxyUrl(env: EnvLike = process.env): string | undefined {
  const fileProxy = getProxyConfigFromFile()
  if (fileProxy?.https) return fileProxy.https
  if (fileProxy?.http) return fileProxy.http

  return env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY
}

export function getSocks5ProxyUrl(env: EnvLike = process.env): string | undefined {
  const fileProxy = getProxyConfigFromFile()
  if (fileProxy?.socks5) return fileProxy.socks5

  return env.socks_proxy || env.SOCKS_PROXY || env.socks5_proxy || env.SOCKS5_PROXY
}

export function getNoProxy(env: EnvLike = process.env): string[] {
  const fileProxy = getProxyConfigFromFile()
  if (fileProxy?.no_proxy && fileProxy.no_proxy.length > 0) {
    return fileProxy.no_proxy
  }

  const envNoProxy = env.no_proxy || env.NO_PROXY || ''
  return envNoProxy.split(/[,\s]+/).filter(Boolean)
}

export function shouldBypassProxy(
  urlString: string,
  noProxy: string[] = getNoProxy(),
): boolean {
  if (noProxy.length === 0) return false

  if (noProxy.includes('*')) return true

  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const hostWithPort = `${hostname}:${port}`

    return noProxy.some(pattern => {
      pattern = pattern.toLowerCase().trim()

      if (pattern.includes(':')) {
        return hostWithPort === pattern
      }

      if (pattern.startsWith('.')) {
        const suffix = pattern
        return hostname === pattern.substring(1) || hostname.endsWith(suffix)
      }

      return hostname === pattern
    })
  } catch {
    return false
  }
}

function createHttpsProxyAgent(
  proxyUrl: string,
  extra: HttpsProxyAgentOptions<string> = {},
): HttpsProxyAgent<string> {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  const agentOptions: HttpsProxyAgentOptions<string> = {
    ...(mtlsConfig && {
      cert: mtlsConfig.cert,
      key: mtlsConfig.key,
      passphrase: mtlsConfig.passphrase,
    }),
    ...(caCerts && { ca: caCerts }),
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS)) {
    agentOptions.lookup = (hostname, options, callback) => {
      callback(null, hostname, getAddressFamily(options))
    }
  }

  return new HttpsProxyAgent(proxyUrl, { ...agentOptions, ...extra })
}

export function createAxiosInstance(
  extra: HttpsProxyAgentOptions<string> = {},
): AxiosInstance {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()
  const instance = axios.create({ proxy: false })

  if (!proxyUrl) {
    if (mtlsAgent) instance.defaults.httpsAgent = mtlsAgent
    return instance
  }

  const proxyAgent = createHttpsProxyAgent(proxyUrl, extra)
  instance.interceptors.request.use(config => {
    if (config.url && shouldBypassProxy(config.url)) {
      config.httpsAgent = mtlsAgent
      config.httpAgent = mtlsAgent
    } else {
      config.httpsAgent = proxyAgent
      config.httpAgent = proxyAgent
    }
    return config
  })
  return instance
}

export const getProxyAgent = memoize((uri: string): undici.Dispatcher => {
  const undiciMod = require('undici') as typeof undici
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  const proxyOptions: undici.EnvHttpProxyAgent.Options & {
    requestTls?: {
      cert?: string | Buffer
      key?: string | Buffer
      passphrase?: string
      ca?: string | string[] | Buffer
    }
  } = {
    httpProxy: uri,
    httpsProxy: uri,
    noProxy: process.env.NO_PROXY || process.env.no_proxy,
  }

  if (mtlsConfig || caCerts) {
    const tlsOpts = {
      ...(mtlsConfig && {
        cert: mtlsConfig.cert,
        key: mtlsConfig.key,
        passphrase: mtlsConfig.passphrase,
      }),
      ...(caCerts && { ca: caCerts }),
    }
    proxyOptions.connect = tlsOpts
    proxyOptions.requestTls = tlsOpts
  }

  return new undiciMod.EnvHttpProxyAgent(proxyOptions)
})

export const getSocks5ProxyAgent = memoize((uri: string): undici.Dispatcher => {
  try {
    const { SocksProxyAgent } = require('socks-proxy-agent')
    const mtlsConfig = getMTLSConfig()
    const caCerts = getCACertificates()

    const tlsOpts = {}
    if (mtlsConfig) {
      Object.assign(tlsOpts, {
        cert: mtlsConfig.cert,
        key: mtlsConfig.key,
        passphrase: mtlsConfig.passphrase,
      })
    }
    if (caCerts) {
      Object.assign(tlsOpts, { ca: caCerts })
    }

    return new SocksProxyAgent(uri, tlsOpts)
  } catch (error) {
    logForDebugging(`SOCKS5 proxy agent creation failed: ${error}`, { level: 'error' })
    throw error
  }
})

export function getWebSocketProxyAgent(url: string): Agent | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return createHttpsProxyAgent(proxyUrl)
}

export function getWebSocketProxyUrl(url: string): string | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return proxyUrl
}

export function getProxyFetchOptions(opts?: { forAnthropicAPI?: boolean }): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string
  unix?: string
  keepalive?: false
} {
  const base = keepAliveDisabled ? ({ keepalive: false } as const) : {}

  if (opts?.forAnthropicAPI) {
    const unixSocket = process.env.ANTHROPIC_UNIX_SOCKET
    if (unixSocket && typeof Bun !== 'undefined') {
      return { ...base, unix: unixSocket }
    }
  }

  const proxyUrl = getProxyUrl()
  const socks5Url = getSocks5ProxyUrl()

  if (socks5Url) {
    if (typeof Bun !== 'undefined') {
      return { ...base, proxy: socks5Url, ...getTLSFetchOptions() }
    }
    return { ...base, dispatcher: getSocks5ProxyAgent(socks5Url) }
  }

  if (proxyUrl) {
    if (typeof Bun !== 'undefined') {
      return { ...base, proxy: proxyUrl, ...getTLSFetchOptions() }
    }
    return { ...base, dispatcher: getProxyAgent(proxyUrl) }
  }

  return { ...base, ...getTLSFetchOptions() }
}

let proxyInterceptorId: number | undefined

export function configureGlobalAgents(): void {
  const proxyUrl = getProxyUrl()
  const socks5Url = getSocks5ProxyUrl()
  const mtlsAgent = getMTLSAgent()

  if (proxyInterceptorId !== undefined) {
    axios.interceptors.request.eject(proxyInterceptorId)
    proxyInterceptorId = undefined
  }

  axios.defaults.proxy = undefined
  axios.defaults.httpAgent = undefined
  axios.defaults.httpsAgent = undefined

  if (socks5Url) {
    axios.defaults.proxy = false
    const socks5Agent = getSocks5ProxyAgent(socks5Url)
    proxyInterceptorId = axios.interceptors.request.use(config => {
      if (config.url && shouldBypassProxy(config.url)) {
        if (mtlsAgent) {
          config.httpsAgent = mtlsAgent
          config.httpAgent = mtlsAgent
        } else {
          delete config.httpsAgent
          delete config.httpAgent
        }
      } else {
        config.httpsAgent = socks5Agent
        config.httpAgent = socks5Agent
      }
      return config
    })

    if (typeof Bun === 'undefined') {
      require('undici').setGlobalDispatcher(getSocks5ProxyAgent(socks5Url))
    }
  } else if (proxyUrl) {
    axios.defaults.proxy = false
    const proxyAgent = createHttpsProxyAgent(proxyUrl)

    proxyInterceptorId = axios.interceptors.request.use(config => {
      if (config.url && shouldBypassProxy(config.url)) {
        if (mtlsAgent) {
          config.httpsAgent = mtlsAgent
          config.httpAgent = mtlsAgent
        } else {
          delete config.httpsAgent
          delete config.httpAgent
        }
      } else {
        config.httpsAgent = proxyAgent
        config.httpAgent = proxyAgent
      }
      return config
    })

    if (typeof Bun === 'undefined') {
      require('undici').setGlobalDispatcher(getProxyAgent(proxyUrl))
    }
  } else if (mtlsAgent) {
    axios.defaults.httpsAgent = mtlsAgent

    const mtlsOptions = getTLSFetchOptions()
    if (mtlsOptions.dispatcher && typeof Bun === 'undefined') {
      require('undici').setGlobalDispatcher(mtlsOptions.dispatcher)
    }
  }
}

export async function getAWSClientProxyConfig(): Promise<object> {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return {}
  }

  const [{ NodeHttpHandler }, { defaultProvider }] = await Promise.all([
    import('@smithy/node-http-handler'),
    import('@aws-sdk/credential-provider-node'),
  ])

  const agent = createHttpsProxyAgent(proxyUrl)
  const requestHandler = new NodeHttpHandler({
    httpAgent: agent,
    httpsAgent: agent,
  })

  return {
    requestHandler,
    credentials: defaultProvider({
      clientConfig: { requestHandler },
    }),
  }
}

export function clearProxyCache(): void {
  getProxyAgent.cache.clear?.()
  getSocks5ProxyAgent.cache.clear?.()
  logForDebugging('Cleared proxy agent cache')
}
