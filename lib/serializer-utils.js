'use strict';
var isPlainObject = require('lodash/isPlainObject');
var isFunction = require('lodash/isFunction');
var _find = require('lodash/find');
var _extend = require('lodash/extend');
var _transform = require('lodash/transform');
var _mapValues = require('lodash/mapValues');
var _mapKeys = require('lodash/mapKeys');
var _pick = require('lodash/pick');
var _keys = require('lodash/keys');
var _each = require('lodash/each');
var Inflector = require('./inflector');

module.exports = function (collectionName, record, payload, opts) {
  function isComplexType(obj) {
    return Array.isArray(obj) || isPlainObject(obj);
  }

  function keyForAttribute(attribute) {
    if (isPlainObject(attribute)) {
      return _transform(attribute, function (result, value, key) {
        if (isComplexType(value)) {
          result[keyForAttribute(key)] = keyForAttribute(value);
        } else {
          result[keyForAttribute(key)] = value;
        }
      });
    } else if (Array.isArray(attribute)) {
      return attribute.map(function (attr) {
        if (isComplexType(attr)) {
          return keyForAttribute(attr);
        } else {
          return attr;
        }
      });
    } else {
      if (isFunction(opts._keyForAttribute)) {
        return opts._keyForAttribute(attribute);
      } else {
        return Inflector.caserize(attribute, opts);
      }
    }
  }

  function getId() {
    return opts._id || 'id';
  }

  function getRef(current, item, opts) {
    if (isFunction(opts._ref)) {
      return opts._ref(current, item);
    } else if (opts._ref === true) {
      if (Array.isArray(item)) {
        return item.map(function (val) {
          return String(val);
        });
      } else if (item) {
        return String(item);
      }
    } else if (item && item[opts._ref]){
      return String(item[opts._ref]);
    }
  }

  function getType(str, attrVal) {
    var type;
    attrVal = attrVal || {};

    if (isFunction(opts._typeForAttribute)) {
      type = opts._typeForAttribute(str, attrVal);
    }

    // If the pluralize option is on, typeForAttribute returned undefined or wasn't used
    if ((opts._pluralizeType === undefined || opts._pluralizeType) && type === undefined) {
      type = Inflector.pluralize(str);
    }

    if (type === undefined) {
      type = str;
    }

    return type;
  }

  function getLinks(current, links, dest) {
    return _mapValues(links, function (value) {
      if (isFunction(value)) {
        return value(record, current, dest);
      } else {
        return value;
      }
    });
  }

  function getMeta(current, meta) {
    return _mapValues(meta, function (value) {
      if (isFunction(value)) {
        return value(record, current);
      } else {
        return value;
      }
    });
  }

  function pick(obj, attributes) {
    return _mapKeys(_pick(obj, attributes), function (value, key) {
      return keyForAttribute(key);
    });
  }

  function isCompoundDocumentIncluded(included, item) {
    return _find(payload.included, { id: item.id, type: item.type });
  }

  function pushToIncluded(dest, include) {
    if (!isCompoundDocumentIncluded(dest, include)) {
      if (!dest.included) { dest.included = []; }
      dest.included.push(include);
    }
  }

  this.serialize = function (dest, current, attribute, opts) {
    var that = this;
    var data = null;

    if (opts && opts._ref) {
      if (!dest.relationships) { dest.relationships = {}; }

      if (Array.isArray(current[attribute])) {
        data = current[attribute].map(function (item) {
          return that.serializeRef(item, current, attribute, opts);
        });
      } else {
        data = that.serializeRef(current[attribute], current, attribute,
          opts);
      }

      dest.relationships[keyForAttribute(attribute)] = {};
      if (!opts._ignoreRelationshipData) {
        dest.relationships[keyForAttribute(attribute)].data = data;
      }

      if (opts._relationshipLinks) {
        dest.relationships[keyForAttribute(attribute)].links =
          getLinks(current[attribute], opts._relationshipLinks, dest);
      }

      if (opts._relationshipMeta) {
        dest.relationships[keyForAttribute(attribute)].meta =
          getMeta(current[attribute], opts._relationshipMeta);
      }
    } else {
      if (Array.isArray(current[attribute])) {
        if (current[attribute].length && isPlainObject(current[attribute][0])) {
          data = current[attribute].map(function (item) {
            return that.serializeNested(item, current, attribute, opts);
          });
        } else {
          data = current[attribute];
        }

        dest.attributes[keyForAttribute(attribute)] = data;
      } else if (isPlainObject(current[attribute])) {
        data = that.serializeNested(current[attribute], current, attribute, opts);
        dest.attributes[keyForAttribute(attribute)] = data;
      } else {
        dest.attributes[keyForAttribute(attribute)] = current[attribute];
      }
    }
  };

  this.serializeRef = function (dest, current, attribute, opts) {
    var that = this;
    var id = getRef(current, dest, opts);
    var type = opts._type || getType(attribute, dest);

    var relationships = [];
    var includedAttrs = [];

    if (opts._attributes) {
      relationships = opts._attributes.filter(function (attr) {
        return opts[attr];
      });

      includedAttrs = opts._attributes.filter(function (attr) {
        return !opts[attr];
      });
    }

    var included = { type: type, id: id };
    if (includedAttrs) { included.attributes = pick(dest, includedAttrs); }

    relationships.forEach(function (relationship) {
      if (dest) {
        that.serialize(included, dest, relationship, opts[relationship]);
      }
    });

    if (opts._dataMeta) {
      included.meta = getMeta(dest, opts._dataMeta);
    }

    if (includedAttrs.length &&
      (opts._included === undefined || opts._included)) {
      if (opts._includedLinks) {
        included.links = getLinks(dest, opts._includedLinks);
      }

      if (typeof id !== 'undefined') { pushToIncluded(payload, included); }
    }

    return typeof id !== 'undefined' ? { type: type, id: id } : null;
  };

  this.serializeNested = function (dest, current, attribute, opts) {
    var that = this;

    var embeds = [];
    var attributes = [];

    if (opts && opts._attributes) {
      embeds = opts._attributes.filter(function (attr) {
        return opts[attr];
      });

      attributes = opts._attributes.filter(function (attr) {
        return !opts[attr];
      });
    } else {
      attributes = _keys(dest);
    }

    var ret = {};
    if (attributes) { ret.attributes = pick(dest, attributes); }

    embeds.forEach(function (embed) {
      if (isComplexType(dest[embed])) {
        that.serialize(ret, dest, embed, opts[embed]);
      }
    });

    return ret.attributes;
  };

  this.perform = function () {
    var that = this;

    if( record === null ){
        return null;
    }

    // If option is present, transform record
    if (opts && opts._transform) {
      record = opts._transform(record);
    }

    // Top-level data.
    var data = {
      type: getType(collectionName, record),
      id: String(record[getId()])
    };

    // Data links.
    if (opts._dataLinks) {
      data.links = getLinks(record, opts._dataLinks);
    }

    // Data meta
    if (opts._dataMeta) {
      data.meta = getMeta(record, opts._dataMeta);
    }

    _each(opts._attributes, function (attribute) {
      var splittedAttributes = attribute.split(':');

      if (opts[attribute] && !record[attribute] && opts[attribute]._nullIfMissing) {
        record[attribute] = null;
      }

      if (splittedAttributes[0] in record) {
        if (!data.attributes) { data.attributes = {}; }

        var attributeMap = attribute;
        if (splittedAttributes.length > 1) {
          attribute = splittedAttributes[0];
          attributeMap = splittedAttributes[1];
        }

        that.serialize(data, record, attribute, opts[attributeMap]);
      }
    });

    return data;
  };
};
