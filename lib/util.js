import _ from 'lodash'
import Adapter from './adapter'
import CriteriaParser from 'waterline-sequel/sequel/lib/criteriaProcessor'

const Util = {

  PG_MAX_INT: 2147483647,
  JS_MAX_INT: Number.MAX_SAFE_INTEGER,
  
  commitTransaction (parentTransaction, transaction, result, cb) {
    if (transaction && _.isFunction(transaction.commit) && !parentTransaction) {
      return transaction.commit()
        .then(() => {
          _.isFunction(cb) && cb(null, result)
        })
    }
    else {
      _.isFunction(cb) && cb(null, result)
      return result
    }
  },

  getTransaction (connection, parentTransaction) {
    return new Promise (resolve => {
      if (parentTransaction) {
        resolve(parentTransaction)
      }
      else if (connection.enableTransactions !== false) {
        connection.knex.transaction(txn => {
          resolve(txn)
        })
      }
      else {
        resolve(connection.knex)
      }
    })
  },

  /**
   * Apply a primary key constraint to a table
   *
   * @param table - a knex table object
   * @param definition - a waterline attribute definition
   */
  applyPrimaryKeyConstraints (table, definition) {
    let primaryKeys = _.keys(_.pick(definition, attribute => {
      return attribute.primaryKey
    }))

    return table.primary(primaryKeys)
  },

  applyTableConstraints(table, definition) {
    return this.applyPrimaryKeyConstraints(table, definition)
  },

  applyColumnConstraints (column, definition) {
    if (_.isString(definition)) {
      return
    }
    return _.map(definition, (value, key) => {
      if (key == 'defaultsTo' && definition.autoIncrement && value == 'AUTO_INCREMENT') {
        return
      }

      return this.applyParticularColumnConstraint(column, key, value)
    })
  },

  applyParticularColumnConstraint (column, constraintName, value) {
    if (!value) return

    switch (constraintName) {
      
      case 'index':
        return column.index(_.get(value, 'indexName'), _.get(value, 'indexType'))

      case 'unique':
        return column.unique()

      case 'notNull':
        return column.notNullable()

      case 'defaultsTo':
        return column.defaultTo(value)

      case 'type':
      case 'primaryKey':
      case 'autoIncrement':
      case 'on':
      case 'via':
      case 'foreignKey':
      case 'references':
      case 'model':
      case 'alias':
        return

      default:
        console.error('Unknown constraint [', constraintName, '] on column')
    }
  },

  toKnexColumn (table, _name, attrDefinition) {
    let attr = _.isObject(attrDefinition) ? attrDefinition : { type: attrDefinition }
    let type = attr.autoIncrement ? 'serial' : attr.type
    let name = attr.columnName || _name

    switch (type.toLowerCase()) {
      /**
       * table.text(name, [textType]) 
       * Adds a text column, with optional textType for MySql text datatype preference. 
       * textType may be mediumtext or longtext, otherwise defaults to text.
       */
      case 'character varying':
      case 'text':
      case 'mediumtext':
      case 'longtext':
        return table.text(name, type)

      /**
       * table.string(name, [length]) 
       * Adds a string column, with optional length defaulting to 255.
       */
      case 'string':
        return table.string(name, attr.length)

      case 'serial':
      case 'smallserial':
        return table.specificType(name, 'serial')
      case 'bigserial':
        return table.specificType(name, 'bigserial')

      /**
       * table.boolean(name) 
       * Adds a boolean column.
       */
      case 'boolean':
        return table.boolean(name)

      /**
       * table.integer(name) 
       * Adds an integer column.
       */
      case 'int':
      case 'integer':
      case 'smallint':
        return table.integer(name)

      /**
       * table.bigInteger(name) 
       * In MySQL or PostgreSQL, adds a bigint column, otherwise adds a normal integer. Note that bigint data is returned as a string in queries because JavaScript may be unable to parse them without loss of precision.
       */
      case 'bigint':
      case 'biginteger':
        return table.bigInteger(name)

      /**
       * table.float(column, [precision], [scale]) 
       * Adds a float column, with optional precision and scale.
       */
      case 'real':
      case 'float':
        return table.float(name, attr.precision, attr.scale)

      case 'double':
        return table.float(name, 15, attr.scale)

      /**
       * table.decimal(column, [precision], [scale]) 
       * Adds a decimal column, with optional precision and scale.
       */
      case 'decimal':
        return table.decimal(name, attr.precision, attr.scale)

      /**
       * table.time(name) 
       * Adds a time column.
       */
      case 'time':
        return table.time(name)

      /**
       * table.date(name) 
       * Adds a date column.
       */
      case 'date':
        return table.date(name)

      /**
       * table.timestamp(name, [standard]) 
       * Adds a timestamp column, defaults to timestamptz in PostgreSQL, unless true is passed as the second argument. 
       * Note that the method for defaulting to the current datetime varies from one database to another. For example: PostreSQL requires .defaultTo(knex.raw('now()')), but SQLite3 requires .defaultTo(knex.raw("date('now')")).
       */
      case 'datestamp':
      case 'datetime':
        return table.timestamp(name, attr.standard)

      case 'array':
        return table.specificType(name, 'text ARRAY')

      /**
       * table.json(name, [jsonb]) 
       * Adds a json column, using the built-in json type in postgresql, defaulting to a text column in older versions of postgresql or in unsupported databases. jsonb can be used by passing true as the second argument.
       */
      case 'json':
        return table.json(name)

      case 'jsonb':
        return table.json(name, true)

      case 'binary':
      case 'bytea':
        return table.binary(name)

      /**
       * table.uuid(name) 
       * Adds a uuid column - this uses the built-in uuid type in postgresql, and falling back to a char(36) in other databases.
       */
      case 'uuid':
        return table.uuid(name).defaultTo('uuid_generate_v4()')

      /**
       * table.enu(col, values) 
       * Adds a enum column, (aliased to enu, as enum is a reserved word in javascript).
       */
      case 'enum':
      case 'enu':
        return table.enu(name, attr.enum)

      case 'comment':
        return table.comment(attr.comment)

      case 'sqltype':
      case 'sqlType':
        return table.specificType(name, type)

      default:
        console.error('Unregistered type given for attribute. name=', name, '; type=', type)
        return table.text(name)
    }
  },

  toKnexRawQuery (sql) {
    return sql.replace(/\$\d+/g, '?')
  },

  castValues (values) {
    return _.map(values, value => {
      if (_.isString(value) && value[0] === '[') {
        let arr = JSON.parse(value)
        if (_.isArray(arr)) {
          return arr
        }
      }

      return value
    })
  },

  sanitize (data, schema) {
    _.each(data, (value, attr) => {
      let definition = schema.definition[attr]

      // remove any autoIncrement fields from data
      if (definition.autoIncrement) {
        delete data[attr]
      }
    })

    return data
  },

  buildKnexJoin (cxn, tableName, options) {
    let selectClause = cxn.knex.raw([
      `"${tableName}".*`,
      ...this.buildSelectAggregationColumns(cxn, options)
    ].join(', '))

    let pk = Adapter.getPrimaryKey(cxn.identity, tableName)

    let query = cxn.knex
      .select(selectClause)
      .from(tableName)
      .where(this.buildWhereClause(cxn, tableName, options))
      .groupBy(`${tableName}.${pk}`)
      .orderByRaw(this.buildOrderByClause(tableName, options))
      .limit(options.limit || this.PG_MAX_INT)
      .offset(options.skip || 0)

    _.each(options.joins, join => {
      let subquery = this.buildKnexJoinSubquery(cxn, join)
      let alias = this.getSubqueryAlias(join)
      query.joinRaw(`left join lateral (${subquery}) as "${alias}" on true`)
    })

    return query
  },

  buildKnexJoinSubquery (cxn, join) {
    let criteria = join.criteria || { }
    let parentAlias = this.getParentAlias(join)
    let subquery = cxn.knex
      .select()
      .from(join.child)
      .where(this.buildWhereClause(cxn, join.child, criteria))
      .andWhereRaw(`"${join.child}"."${join.childKey}" = "${parentAlias}"."${join.parentKey}"`)

    return subquery
  },

  buildOrderByClause (tableName, options) {
    if (_.isEmpty(options.sort)) {
      return '1'
    }

    let queryTokens = _.map(options.sort, (_direction, field) => {
      let direction = _direction === 1 ? '' : 'desc'
      return `"${tableName}"."${field}" ${direction}`
    })
    return queryTokens.join(', ')
  },

  buildWhereClause (cxn, tableName, options) {
    let parser = new CriteriaParser(tableName, cxn.schema, Adapter.wlSqlOptions)
    let clause = parser.read(_.omit(options, [
      'sort', 'limit', 'groupBy', 'skip'
    ]))

    return cxn.knex.raw(this.toKnexRawQuery(clause.query), this.castValues(clause.values))
  },

  getJoinAlias (join) {
    if (join.alias != join.parentKey && join.removeParentKey === true) {
      return join.parentKey
    }
    else {
      return join.alias
    }
  },

  getParentAlias (join) {
    if (join.junctionTable) {
      return this.getJoinAlias(join) + join.parent
    }
    else {
      return join.parent
    }
  },

  getSubqueryAlias (join) {
    return this.getJoinAlias(join) + join.child
  },

  buildSelectAggregationColumns (cxn, options) {
    return _.map(_.reject(options.joins, { select: false }), join => {

      let criteria = join.criteria || { }
      let subqueryAlias = this.getSubqueryAlias(join)
      let asColumn = this.getJoinAlias(join)
      let orderBy = this.buildOrderByClause(subqueryAlias, criteria)
      let start = (criteria.skip || 0) + 1
      let end = (criteria.limit || (this.PG_MAX_INT - start)) + start - 1

      return `
        array_to_json(
          (array_remove(array_agg("${subqueryAlias}".* order by ${orderBy}), null))[${start}:${end}]
        ) as "${asColumn}"
      `
    })
  },

  buildSelectColumns (tableName, select) {
    return _.map(select, column => `"${tableName}"."${column}"`)
  },

  validateVersion (version) {
    let major = Number(version[0])
    let minor = Number(version[1])
    let patch = Number(version[2])

    if (major < 9 || (major == 9 && minor < 2)) {
      throw new Error(`
        PostgreSQL ${major}.${minor}.${patch} detected. This adapter requires PostgreSQL 9.2 or higher.
        Please either:
        1. Upgrade your Postgres server to at least 9.2.0 -or-
        2. Use the sails-postgresql adapter instead: https://www.npmjs.com/package/sails-postgresql
      `)
    }

    return parseFloat(`${major}.${minor}`)
  }
}

_.bindAll(Util)
export default Util