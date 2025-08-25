////plugins/mongo/helpers/models.js **GPT NOTE: DONT REMOVE THIS LINE IN EXAMPLES**

import { getDb } from '../../../../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

export default class ModelHelper {
  constructor(collectionName) {
    this.collectionName = collectionName;
    this.modelFields = {};
  }

  async create(document) {
    const db = getDb();
    const collection = db.collection(this.collectionName);
    const processedDocument = this.processData(document);
    const result = await collection.insertOne(processedDocument);
    return result.insertedId ? await collection.findOne({ _id: result.insertedId }) : null;
  }

  async getAll(query = {}) {
    const db = getDb();
    return await db.collection(this.collectionName).find(query).toArray();
  }

  async getById(id) {
    if (!ObjectId.isValid(id)) throw new Error('Invalid ID format');
    const db = getDb();
    return await db.collection(this.collectionName).findOne({ _id: new ObjectId(id) });
  }

  async updateById(id, updatedDocument) {
    if (!ObjectId.isValid(id)) throw new Error('Invalid ID format');
    const db = getDb();
    const processedDocument = this.processData(updatedDocument);
    const result = await db.collection(this.collectionName).updateOne(
      { _id: new ObjectId(id) },
      { $set: processedDocument }
    );
    return result.matchedCount > 0 ? await this.getById(id) : null;
  }

  async deleteById(id) {
    if (!ObjectId.isValid(id)) throw new Error('Invalid ID format');
    const db = getDb();
    const result = await db.collection(this.collectionName).deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount > 0;
  }
  processData(data) {
    const processedData = {};
    const ModelClass = this.constructor; // Get the actual model class
    console.log("Processing data:", data); // Debug incoming data
    console.log("Model Fields:", ModelClass.modelFields); // Debug model fields

    if (!ModelClass.modelFields) {
        console.error("Error: modelFields is undefined in", ModelClass.name);
        return {}; // Return empty to prevent crashes
    }

    for (const key in ModelClass.modelFields) {
        if (data[key] !== undefined) {
            processedData[key] = this.castValue(data[key], ModelClass.modelFields[key].type);
        }
    }

    console.log("Processed data ready for DB:", processedData); // Debug processed data
    return processedData;
}


  castValue(value, type) {
    switch (type) {
      case 'number': return Number(value);
      case 'boolean': return Boolean(value);
      case 'array': return Array.isArray(value) ? value : [value];
      case 'object': return typeof value === 'object' ? value : JSON.parse(value);
      case 'date': return new Date(value);
      default: return String(value);
    }
  }


  
}
