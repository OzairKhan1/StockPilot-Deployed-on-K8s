const express = require('express');
const mongoose = require('mongoose');
const client = require('prom-client');

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb-service:27017/stockpilot';

// ---------- Models ----------
const whole = { validator: Number.isInteger, message: '{PATH} must be a whole number' };

const Product = mongoose.model('Product', new mongoose.Schema({
  sku:          { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32 },
  name:         { type: String, required: true, trim: true, maxlength: 120 },
  category:     { type: String, trim: true, default: 'General', maxlength: 60 },
  location:     { type: String, trim: true, default: '', maxlength: 40 },   // aisle-shelf-bin, e.g. A-01-3
  unit:         { type: String, trim: true, default: 'pcs', maxlength: 12 },
  quantity:     { type: Number, default: 0, min: 0, validate: whole },
  reorderLevel: { type: Number, default: 10, min: 0, validate: whole },
  unitCost:     { type: Number, default: 0, min: 0 }
}, { timestamps: true }));

const Movement = mongoose.model('Movement', new mongoose.Schema({
  product:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', index: true },
  sku:          String,
  name:         String,
  type:         { type: String, enum: ['IN', 'OUT', 'ADJUST'], required: true },
  delta:        { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  note:         { type: String, trim: true, maxlength: 200, default: '' }
}, { timestamps: { createdAt: true, updatedAt: false } }));

const DEMO = [
  { sku: 'BOX-404030', name: 'Corrugated Box 40x30x30 cm', category: 'Packaging',   location: 'A-01-1', unit: 'pcs',   quantity: 240, reorderLevel: 100, unitCost: 0.85 },
  { sku: 'TAPE-48',    name: 'Packing Tape 48 mm',          category: 'Packaging',   location: 'A-01-3', unit: 'rolls', quantity: 36,  reorderLevel: 40,  unitCost: 1.6 },
  { sku: 'WRAP-500',   name: 'Stretch Wrap 500 mm',         category: 'Packaging',   location: 'A-02-1', unit: 'rolls', quantity: 58,  reorderLevel: 25,  unitCost: 6.9 },
  { sku: 'PAL-1208',   name: 'Euro Pallet 1200x800',        category: 'Pallets',     location: 'B-00-0', unit: 'pcs',   quantity: 120, reorderLevel: 50,  unitCost: 11 },
  { sku: 'LBL-10050',  name: 'Thermal Labels 100x50 mm',    category: 'Labels',      location: 'C-02-4', unit: 'rolls', quantity: 12,  reorderLevel: 30,  unitCost: 4.2 },
  { sku: 'GLV-L',      name: 'Safety Gloves (L)',           category: 'Safety',      location: 'D-01-2', unit: 'pairs', quantity: 0,   reorderLevel: 20,  unitCost: 2.4 },
  { sku: 'VEST-HV',    name: 'Hi-Vis Vest',                 category: 'Safety',      location: 'D-01-4', unit: 'pcs',   quantity: 45,  reorderLevel: 15,  unitCost: 5.5 },
  { sku: 'BATT-AA',    name: 'AA Batteries (scanners)',     category: 'Consumables', location: 'E-03-1', unit: 'packs', quantity: 80,  reorderLevel: 30,  unitCost: 3.1 }
];

// ---------- Metrics ----------
client.collectDefaultMetrics();
const dbReady = () => mongoose.connection.readyState === 1;

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2]
});
new client.Gauge({
  name: 'stockpilot_low_stock_products',
  help: 'Products at or below their reorder level',
  async collect() {
    if (!dbReady()) return;
    this.set(await Product.countDocuments({ $expr: { $lte: ['$quantity', '$reorderLevel'] } }));
  }
});
new client.Gauge({
  name: 'stockpilot_inventory_units',
  help: 'Total units on hand',
  async collect() {
    if (!dbReady()) return;
    const [r] = await Product.aggregate([{ $group: { _id: null, n: { $sum: '$quantity' } } }]);
    this.set(r ? r.n : 0);
  }
});

// ---------- App ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

const QUIET = new Set(['/api/live', '/api/health', '/metrics']);
app.use((req, res, next) => {
  const started = Date.now();
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
    end({ method: req.method, route, status: res.statusCode });
    if (!QUIET.has(route)) {
      console.log(JSON.stringify({
        ts: new Date().toISOString(), method: req.method, path: req.originalUrl,
        status: res.statusCode, ms: Date.now() - started, pod: process.env.HOSTNAME
      }));
    }
  });
  next();
});

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
const CREATE_FIELDS = ['sku', 'name', 'category', 'location', 'unit', 'quantity', 'reorderLevel', 'unitCost'];
const EDIT_FIELDS = ['name', 'category', 'location', 'unit', 'reorderLevel', 'unitCost'];

// --- health ---
app.get('/api/live', (req, res) => res.json({ status: 'UP' }));          // liveness: no DB dependency
app.get('/api/health', (req, res) => {                                   // readiness: reflects DB
  const up = dbReady();
  res.status(up ? 200 : 503).json({ status: up ? 'UP' : 'DOWN', db: up, pod: process.env.HOSTNAME, timestamp: new Date() });
});
app.get('/metrics', wrap(async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}));

// --- dashboard ---
app.get('/api/stats', wrap(async (req, res) => {
  const [[t], categories] = await Promise.all([
    Product.aggregate([{ $group: {
      _id: null,
      products: { $sum: 1 },
      units: { $sum: '$quantity' },
      value: { $sum: { $multiply: ['$quantity', '$unitCost'] } },
      low: { $sum: { $cond: [{ $lte: ['$quantity', '$reorderLevel'] }, 1, 0] } },
      out: { $sum: { $cond: [{ $eq: ['$quantity', 0] }, 1, 0] } }
    } }]).then(r => [r[0]]),
    Product.aggregate([{ $group: { _id: '$category', units: { $sum: '$quantity' } } }, { $sort: { units: -1 } }])
  ]);
  const s = t || {};
  res.json({
    products: s.products || 0, units: s.units || 0, inventoryValue: s.value || 0,
    lowStock: s.low || 0, outOfStock: s.out || 0,
    categories: categories.map(c => ({ name: c._id, units: c.units }))
  });
}));

// --- products ---
app.get('/api/products', wrap(async (req, res) => {
  const filter = req.query.status === 'low' ? { $expr: { $lte: ['$quantity', '$reorderLevel'] } } : {};
  res.json(await Product.find(filter).sort({ name: 1 }).limit(500));
}));

app.post('/api/products', wrap(async (req, res) => {
  const product = await Product.create(pick(req.body, CREATE_FIELDS));
  if (product.quantity > 0) {
    await Movement.create({ product: product._id, sku: product.sku, name: product.name, type: 'IN',
      delta: product.quantity, balanceAfter: product.quantity, note: 'Initial stock' });
  }
  res.status(201).json(product);
}));

app.put('/api/products/:id', wrap(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { $set: pick(req.body, EDIT_FIELDS) },
    { new: true, runValidators: true });
  if (!product) return res.status(404).json({ error: 'product not found' });
  res.json(product);
}));

app.delete('/api/products/:id', wrap(async (req, res) => {
  const product = await Product.findByIdAndDelete(req.params.id);
  if (!product) return res.status(404).json({ error: 'product not found' });
  await Movement.deleteMany({ product: product._id });
  res.status(204).end();
}));

// --- stock movements (atomic) ---
app.post('/api/products/:id/movements', wrap(async (req, res) => {
  const { id } = req.params;
  const type = String(req.body.type || '').toUpperCase();
  const qty = Number(req.body.quantity);
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 200) : '';

  if (!['IN', 'OUT', 'ADJUST'].includes(type)) return res.status(400).json({ error: 'type must be IN, OUT or ADJUST' });
  if (!Number.isInteger(qty) || qty < 0 || (type !== 'ADJUST' && qty === 0)) {
    return res.status(400).json({ error: 'quantity must be a positive whole number' });
  }

  let product, delta;
  if (type === 'IN') {
    product = await Product.findByIdAndUpdate(id, { $inc: { quantity: qty } }, { new: true });
    delta = qty;
  } else if (type === 'OUT') {
    // Only succeeds if enough stock exists, so quantity can never go negative
    product = await Product.findOneAndUpdate({ _id: id, quantity: { $gte: qty } }, { $inc: { quantity: -qty } }, { new: true });
    delta = -qty;
    if (!product) {
      const exists = await Product.exists({ _id: id });
      return res.status(exists ? 409 : 404).json({ error: exists ? 'insufficient stock' : 'product not found' });
    }
  } else {
    const before = await Product.findByIdAndUpdate(id, { $set: { quantity: qty } }, { new: false });
    if (before) { delta = qty - before.quantity; before.quantity = qty; }
    product = before;
  }
  if (!product) return res.status(404).json({ error: 'product not found' });

  const movement = await Movement.create({ product: product._id, sku: product.sku, name: product.name,
    type, delta, balanceAfter: product.quantity, note });
  res.status(201).json({ product, movement });
}));

app.get('/api/movements', wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const filter = req.query.sku ? { sku: String(req.query.sku).toUpperCase() } : {};
  res.json(await Movement.find(filter).sort({ createdAt: -1 }).limit(limit));
}));

// --- errors ---
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  if (err.code === 11000) return res.status(409).json({ error: 'SKU already exists' });
  if (err.name === 'CastError' || err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

// ---------- DB connection (retry, never crash) ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function seed() {
  if (await Product.estimatedDocumentCount() > 0) return;
  try {
    const created = await Product.insertMany(DEMO);
    await Movement.insertMany(created.map(p => ({ product: p._id, sku: p.sku, name: p.name, type: 'IN',
      delta: p.quantity, balanceAfter: p.quantity, note: 'Initial stock' })));
    console.log('Seeded demo inventory');
  } catch (e) {
    if (e.code !== 11000) throw e;   // another replica seeded first
  }
}

async function connectWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      console.log('Connected to MongoDB');
      break;
    } catch (err) {
      console.error(`MongoDB connection failed (attempt ${attempt}): ${err.message}`);
      await sleep(Math.min(attempt * 2000, 15000));
    }
  }
  try { await Product.init(); await seed(); } catch (e) { console.error('Init/seed error:', e.message); }
}

// Listen immediately: liveness stays green, readiness (/api/health) turns green once the DB is up
const server = app.listen(PORT, () => console.log(`StockPilot API listening on ${PORT}`));
connectWithRetry();

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => { await mongoose.disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
