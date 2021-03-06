/*
 * Copyright 2017 The boardgame.io Authors
 *
 * Use of this source code is governed by a MIT-style
 * license that can be found in the LICENSE file or at
 * https://opensource.org/licenses/MIT.
 */

const MongoClient = require('mongodb').MongoClient;
const LRU = require('lru-cache');

/**
 * InMemory data storage.
 */
export class InMemory {
  /**
   * Creates a new InMemory storage.
   */
  constructor() {
    this.games = new Map();
  }

  /**
   * Connect.
   * No-op for the InMemory instance.
   */
  async connect() {
    return;
  }

  /**
   * Write the game state to the in-memory object.
   * @param {string} id - The game id.
   * @param {object} store - A game state to persist.
   */
  async set(id, state) {
    return await this.games.set(id, state);
  }

  /**
   * Read the game state from the in-memory object.
   * @param {string} id - The game id.
   * @returns {object} - A game state, or undefined
   *                     if no game is found with this id.
   */
  async get(id) {
    return await this.games.get(id);
  }

  /**
   * Check if a particular game id exists.
   * @param {string} id - The game id.
   * @returns {boolean} - True if a game with this id exists.
   */
  async has(id) {
    return await this.games.has(id);
  }
}

/**
 * MongoDB connector.
 */
export class Mongo {
  /**
   * Creates a new Mongo connector object.
   */
  constructor({ url, dbname, cacheSize, mockClient }) {
    if (cacheSize === undefined) cacheSize = 1000;
    if (dbname === undefined) dbname = 'bgio';

    this.client = mockClient || MongoClient;
    this.url = url;
    this.dbname = dbname;
    this.cache = new LRU({ max: cacheSize });
  }

  /**
   * Connect to the instance.
   */
  async connect() {
    const c = await this.client.connect(this.url);
    this.db = c.db(this.dbname);
    return;
  }

  /**
   * Write the game state.
   * @param {string} id - The game id.
   * @param {object} store - A game state to persist.
   */
  async set(id, state) {
    // Don't set a value if the cache has a more recent version.
    // This can occur due a race condition.
    //
    // For example:
    //
    // A --sync--> server | DB => 0 --+
    //                                |
    // A <--sync-- server | DB => 0 --+
    //
    // B --sync--> server | DB => 0 ----+
    //                                  |
    // A --move--> server | DB <= 1 --+ |
    //                                | |
    // A <--sync-- server | DB => 1 --+ |
    //                                  |
    // B <--sync-- server | DB => 0 ----+
    //
    const cacheValue = this.cache.get(id);
    if (cacheValue && cacheValue._stateID >= state._stateID) {
      return;
    }

    this.cache.set(id, state);

    const col = this.db.collection(id);
    delete state._id;
    await col.insert(state);

    return;
  }

  /**
   * Read the game state.
   * @param {string} id - The game id.
   * @returns {object} - A game state, or undefined
   *                     if no game is found with this id.
   */
  async get(id) {
    let cacheValue = this.cache.get(id);
    if (cacheValue !== undefined) {
      return cacheValue;
    }

    const col = this.db.collection(id);
    const docs = await col
      .find()
      .sort({ _id: -1 })
      .limit(1)
      .toArray();

    let oldStateID = 0;
    cacheValue = this.cache.get(id);
    /* istanbul ignore next line */
    if (cacheValue !== undefined) {
      /* istanbul ignore next line */
      oldStateID = cacheValue._stateID;
    }

    let newStateID = -1;
    if (docs.length > 0) {
      newStateID = docs[0]._stateID;
    }

    // Update the cache, but only if the read
    // value is newer than the value already in it.
    // A race condition might overwrite the
    // cache with an older value, so we need this.
    if (newStateID >= oldStateID) {
      this.cache.set(id, docs[0]);
    }

    return docs[0];
  }

  /**
   * Check if a particular game exists.
   * @param {string} id - The game id.
   * @returns {boolean} - True if a game with this id exists.
   */
  async has(id) {
    const cacheValue = this.cache.get(id);
    if (cacheValue !== undefined) {
      return true;
    }

    const col = this.db.collection(id);
    const docs = await col
      .find()
      .limit(1)
      .toArray();
    return docs.length > 0;
  }
}
