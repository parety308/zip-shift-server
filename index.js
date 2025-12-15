const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 5000;

// Generate tracking ID
function generateTrackingId() {
    const prefix = 'PARVEZ';
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 chars
    return `${prefix}-${date}-${random}`;
}

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB setup
const uri = process.env.URI;
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
        const db = client.db('zap_shift');
        const parcelCollection = db.collection('parcels');
        const paymentCollection = db.collection('payments');

        // Get all parcels (optionally filter by sender email)
        app.get('/parcels', async (req, res) => {
            const query = {};
            const { email } = req.query;
            if (email) query.senderEmail = email;

            const parcels = await parcelCollection.find(query).sort({ createdAt: -1 }).toArray();
            res.status(200).json(parcels);
        });

        // Get individual parcel
        app.get('/parcels/:parcelId', async (req, res) => {
            const id = req.params.parcelId;
            const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
            res.status(200).json(parcel);
        });

        // Create a new parcel
        app.post('/parcels', async (req, res) => {
            const parcel = req.body;
            parcel.createdAt = new Date();
            parcel.paymentStatus = 'pending'; // default
            const result = await parcelCollection.insertOne(parcel);
            res.status(201).json(result);
        });

        // Delete a parcel
        app.delete('/parcels/:id', async (req, res) => {
            const id = req.params.id;
            const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
            res.status(200).json(result);
        });

        // Create Stripe checkout session
        app.post('/create-checkout-session', async (req, res) => {
            const { parcelName, senderEmail, parcelId, cost } = req.body;
            const amount = parseInt(cost) * 100;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'USD',
                            unit_amount: amount,
                            product_data: { name: parcelName },
                        },
                        quantity: 1,
                    }
                ],
                customer_email: senderEmail,
                mode: 'payment',
                metadata: { parcelId, parcelName },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            res.send({ url: session.url });
        });

        // Handle payment success
        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;
            if (!sessionId) return res.status(400).send({ success: false, message: 'Session ID required' });

            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const trackingI = generateTrackingId();
            if (session.payment_status === 'paid') {
                const trackingId = trackingI;
                const parcelId = session.metadata.parcelId;

                // Update parcel with payment info
                const updateResult = await parcelCollection.updateOne(
                    { _id: new ObjectId(parcelId) },
                    { $set: { paymentStatus: 'paid', trackingId } }
                );

                // Save payment record
                const paymentRecord = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    parcelId: session.metadata.parcelId,
                    parcelName: session.metadata.parcelName,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId
                };

                const paymentResult = await paymentCollection.insertOne(paymentRecord);

                return res.send({
                    success: true,
                    modifiedParcel: updateResult,
                    paymentInfo: paymentResult,
                    trackingId:trackingId,
                    transactionId: session.payment_intent
                });
            }

            res.send({ success: false });
        });

        // Test route
        app.get('/', (req, res) => {
            res.send('ZapShift Backend Server Running');
        });

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged MongoDB deployment successfully!");
    } catch (error) {
        console.error(error);
    }
}

run().catch(console.dir);

app.listen(port, () => {
    console.log(`ZapShift App listening on port ${port}`);
});
