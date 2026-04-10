const express = require('express');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/brownie', express.static(path.join(__dirname, '../brownie')));

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Orders storage file
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// Helper functions
const readOrders = () => {
    try {
        if (fs.existsSync(ORDERS_FILE)) {
            const data = fs.readFileSync(ORDERS_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        return [];
    }
};

const writeOrders = (orders) => {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
};

// API Routes

// Create order and Razorpay payment
app.post('/api/create-order', async (req, res) => {
    try {
        const { amount, currency = 'INR', receipt } = req.body;
        
        const options = {
            amount: amount * 100, // Razorpay expects amount in paise
            currency,
            receipt: receipt || 'receipt_' + Date.now(),
            payment_capture: 1
        };
        
        const order = await razorpay.orders.create(options);
        res.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            key: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify payment and save order
app.post('/api/verify-payment', async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            orderDetails
        } = req.body;
        
        // Verify signature
        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');
        
        const isAuthentic = expectedSignature === razorpay_signature;
        
        if (isAuthentic) {
            // Save order to database
            const orders = readOrders();
            const newOrder = {
                id: 'ORD' + Date.now(),
                razorpayOrderId: razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                ...orderDetails,
                paymentStatus: 'paid',
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            orders.unshift(newOrder);
            writeOrders(orders);
            
            res.json({
                success: true,
                message: 'Payment verified and order placed',
                orderId: newOrder.id
            });
        } else {
            res.status(400).json({ success: false, error: 'Invalid signature' });
        }
    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all orders (Admin)
app.get('/api/orders', (req, res) => {
    const orders = readOrders();
    res.json({ success: true, orders });
});

// Update order status (Admin)
app.put('/api/orders/:orderId/status', (req, res) => {
    const { orderId } = req.params;
    const { status } = req.body;
    
    const orders = readOrders();
    const orderIndex = orders.findIndex(o => o.id === orderId);
    
    if (orderIndex !== -1) {
        orders[orderIndex].status = status;
        orders[orderIndex].updatedAt = new Date().toISOString();
        writeOrders(orders);
        res.json({ success: true, order: orders[orderIndex] });
    } else {
        res.status(404).json({ success: false, error: 'Order not found' });
    }
});

// Get orders by phone number (Customer)
app.get('/api/orders/:phone', (req, res) => {
    const { phone } = req.params;
    const orders = readOrders();
    const userOrders = orders.filter(o => o.customerPhone === phone);
    res.json({ success: true, orders: userOrders });
});

// Save COD order
app.post('/api/cod-order', (req, res) => {
    try {
        const orderDetails = req.body;
        const orders = readOrders();
        const newOrder = {
            id: 'ORD' + Date.now(),
            ...orderDetails,
            paymentStatus: 'pending_cod',
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        orders.unshift(newOrder);
        writeOrders(orders);
        
        res.json({
            success: true,
            message: 'COD order placed successfully',
            orderId: newOrder.id
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get revenue stats (Admin)
app.get('/api/stats', (req, res) => {
    const orders = readOrders();
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === 'pending').length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const paidRevenue = orders
        .filter(o => o.paymentStatus === 'paid')
        .reduce((sum, o) => sum + o.total, 0);
    
    res.json({
        success: true,
        stats: {
            totalOrders,
            pendingOrders,
            totalRevenue,
            paidRevenue
        }
    });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});