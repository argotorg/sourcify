"use strict";

var async = require("async");

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db, callback) {
  async.series(
    [
      db.runSql.bind(
        db,
        `ALTER TABLE verified_contracts ADD COLUMN runtime_metadata_match bool NOT NULL;`,
      ),
      db.runSql.bind(
        db,
        `ALTER TABLE verified_contracts ADD COLUMN creation_metadata_match bool NOT NULL;`,
      ),
    ],
    callback,
  );
};

exports.down = function (db, callback) {
  async.series(
    [
      db.runSql.bind(
        db,
        `ALTER TABLE verified_contracts DROP COLUMN runtime_metadata_match;`,
      ),
      db.runSql.bind(
        db,
        `ALTER TABLE verified_contracts DROP COLUMN creation_metadata_match;`,
      ),
    ],
    callback,
  );
};

exports._meta = {
  version: 1,
};
