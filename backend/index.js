const axios = require("axios");
const { MongoClient } = require("mongodb");
const { parseString } = require("xml2js");

const databaseUrl = "mongodb://admin:adminpassword@localhost:27017/";
const dbName = "prerender";
const dbCollectionName = "tobescanned";
const dbSitemapsName = "inner_sitemaps";
const xmlUrl = "https://www.devcrvtestingmm.com/sitemap_index.xml";

let dbClient = null;
let db = null;
let dbCollection = null;
let dbSitemaps = null;

async function connectToMongoDB() {
  try {
    dbClient = await MongoClient.connect(databaseUrl);
    db = dbClient.db(dbName);
    dbCollection = db.collection(dbCollectionName);
    dbSitemaps = db.collection(dbSitemapsName);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("Error:", error);
  }
}

async function closeMongoDb() {
  dbClient.close();
  console.log("Disconnected from MongoDB");
}

async function parseXML() {
  try {
    const response = await axios.get(xmlUrl);
    const xmlData = response.data;
    const timeNow = Date.now();

    const parsedData = await parseStringPromise(xmlData);

    for (const sitemap of parsedData.sitemapindex.sitemap) {
      let sitemapUrl = sitemap.loc[0];
      const record = await dbSitemaps.findOne({ url: sitemapUrl });

      if (!record) {
        await dbSitemaps.insertOne({
          url: sitemapUrl,
          date: timeNow,
        });
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

async function processSitemaps() {
  const timeNow = Date.now();
  const sitemaps = await dbSitemaps.find({}).toArray();

  for (const sitemap of sitemaps) {
    try {
      const response = await axios.get(sitemap.url);
      const parsedSitemap = await parseStringPromise(response.data);
      const urls = parsedSitemap.urlset.url;

      for (const url of urls) {
        const record = await dbCollection.findOne({ loc: url.loc });

        if (!record) {
          await dbCollection.insertOne({
            ...url,
            insertedAt: timeNow,
            updatedAt: timeNow,
          });
        }
      }
    } catch (error) {
      console.error("Error:", error);
    }
  }

  console.log("Everything is done.");
}

async function run() {
  try {
    await connectToMongoDB();
    await parseXML();
    await processSitemaps();
  } finally {
    closeMongoDb();
  }
}

// Helper function to convert parseString into a Promise-based function
function parseStringPromise(xmlData) {
  return new Promise((resolve, reject) => {
    parseString(xmlData, (error, parsedData) => {
      if (error) {
        reject(error);
      } else {
        resolve(parsedData);
      }
    });
  });
}

run();
