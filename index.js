const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express()
const port = process.env.PORT;

//middleware
app.use(cors());
app.use(express.json());

const uri = process.env.URI;

// Connect MongoDB
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. Parvez successfully connected to MongoDB!");
    }
     finally {
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('ZapShift Backed Server Running ')
})

app.listen(port, () => {
    console.log(`ZapShift  App listening on port ${port}`)
})
