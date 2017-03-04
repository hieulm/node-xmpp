'use strict'

const dns = require('dns')
const compareAltConnections = require('./alt-connections').compare

function lookup (domain, options = {}) {
  options.all = true
  return new Promise((resolve, reject) => {
    dns.lookup(domain, options, (err, records) => {
      if (err) return reject(err)
      resolve(records)
    })
  })
}

function guess (domain, options = {}) {
  return lookup(domain, options).then((records) => {
    const services = options.services
    const _records = []
    records.forEach((record) => {
      if (services.indexOf('client') > -1) {
        _records.push(Object.assign({
          service: 'client',
          type: 'guess',
          uri:`xmpp://${record.address}:5222`
        }, record))
        _records.push(Object.assign({
          service: 'client',
          type: 'guess',
          uri:`xmpps://${record.address}:5223`
        }, record))
      }
      if (services.indexOf('server') > -1) {
        _records.push(Object.assign({
          service: 'server',
          type: 'guess',
          uri: `xmpp://${record.address}:5269`
        }, record))
      }
    })
    return _records
  })
}

function resolveTxt (domain, {owner = '_xmppconnect'}) {
  return new Promise((resolve, reject) => {
    dns.resolveTxt(`${owner}.${domain}`, (err, records) => {
      if (err) {
        err.code === 'ENOTFOUND' ? resolve([]) : reject(err)
        return
      }
      resolve(records.map((record) => {
        const [attribute, value] = record[0].split('=')
        return {
          attribute,
          value,
          method: attribute.split('-').pop(),
          uri: value,
          type: 'txt'
        }
      }).sort(compareAltConnections))
    })
  })
}

function resolveSrv (domain, {service, protocol}) {
  return new Promise((resolve, reject) => {
    dns.resolveSrv(`_${service}._${protocol}.${domain}`, (err, records) => {
      if (err && err.code === 'ENOTFOUND') return resolve([])
      if (err) return reject(err)
      resolve(records.map(record => {
        const protocol = service.indexOf('xmpps-') === 0 ? 'xmpps://' : 'xmpp://'
        const uri = protocol + record.name + ':' + record.port
        return Object.assign(record, {service, protocol, uri, type: 'srv'})
      }))
    })
  })
}

function sortSrv (records) {
  return records.sort((a, b) => {
    const priority = a.priority - b.priority
    if (priority !== 0) return priority

    const weight = b.weight - a.weight
    if (weight !== 0) return weight

    return 0
  })
}

function lookupSrvs (srvs, options) {
  const addresses = []
  return Promise.all(srvs.map((srv) => {
    return lookup(srv.name, options).then((srvAddresses) => {
      srvAddresses.forEach((address) => {
        addresses.push(Object.assign({}, address, srv))
      })
    })
  })).then(() => addresses)
}

const services = {
  'client': [
    {
      service: 'xmpps-client',
      protocol: 'tcp'
    },
    {
      service: 'xmpp-client',
      protocol: 'tcp'
    }
  ],
  'server': [
    {
      service: 'xmpps-server',
      protocol: 'tcp'
    },
    {
      service: 'xmpp-server',
      protocol: 'tcp'
    }
  ],
  'stun': [
    {
      service: 'stun',
      protocol: 'tcp'
    },
    {
      service: 'stun',
      protocol: 'udp'
    },
    {
      service: 'stuns ',
      protcol: 'tcp'
    },
  ],
  'turn': [
    {
      service: 'turn',
      protocol: 'tcp'
    },
    {
      service: 'turn',
      protocol: 'udp'
    },
    {
      service: 'turns',
      protcol: 'tcp'
    }
  ]
}

function resolve (domain, options = {}) {
  if (!options.services) {
    options.services = Object.keys(services)
  }

  let srvs = []
  options.services.forEach((service) => {
    if (!services[service]) return
    srvs = srvs.concat(services[service])
  })
  options.srvs = srvs

  const family = {options}
  return guess(domain, options).then((records) => {
    return Promise.all(options.srvs.map((srv) => {
      return resolveSrv(domain, Object.assign({}, srv, {family})).then((records) => {
        return lookupSrvs(records, options)
      })
    }))
    .then(srvs => sortSrv([].concat(...srvs)).concat(records))
    .then((records) => {
      return resolveTxt(domain, options).then((txtRecords) => {
        return records.concat(txtRecords)
      })
    })
  })
}

module.exports.lookup = lookup
module.exports.resolveSrv = resolveSrv
module.exports.resolveTxt = resolveTxt
module.exports.lookupSrvs = lookupSrvs
module.exports.resolve = resolve
module.exports.sortSrv = sortSrv
module.exports.guess = guess
