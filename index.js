/**
 * TOKO ONLINE 1 FILE
 * - Frontend: HTML + CSS + JS (inline)
 * - Backend: Node.js + Express
 * - DB: SQLite (better-sqlite3)
 * - Fitur: katalog, detail, cart localStorage, checkout, simpan order, admin cek order
 */

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));

// =============== DB INIT =================
const db = new Database("store.db");
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  image_url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  shipping_method TEXT NOT NULL,
  shipping_cost INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  notes TEXT,
  subtotal INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  name_snapshot TEXT NOT NULL,
  price_snapshot INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  line_total INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
`);

function seedIfEmpty() {
  const cnt = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
  if (cnt > 0) return;

  const seed = [
    {
      name: "Kaos Basic Premium",
      price: 79000,
      stock: 25,
      category: "Fashion",
      image_url: "https://picsum.photos/seed/kaos/900/600",
      description: "Kaos basic bahan lembut, nyaman dipakai harian."
    },
    {
      name: "Sepatu Sneakers Urban",
      price: 299000,
      stock: 12,
      category: "Fashion",
      image_url: "https://picsum.photos/seed/sneakers/900/600",
      description: "Sneakers gaya urban, ringan dan cocok untuk aktivitas."
    },
    {
      name: "Botol Minum Stainless 600ml",
      price: 119000,
      stock: 30,
      category: "Home",
      image_url: "https://picsum.photos/seed/botol/900/600",
      description: "Botol minum stainless, menjaga suhu lebih lama."
    },
    {
      name: "Headset Wireless",
      price: 249000,
      stock: 18,
      category: "Elektronik",
      image_url: "https://picsum.photos/seed/headset/900/600",
      description: "Headset wireless dengan mic, nyaman dan suara jernih."
    },
    {
      name: "Lampu Meja Minimalis",
      price: 159000,
      stock: 10,
      category: "Home",
      image_url: "https://picsum.photos/seed/lampu/900/600",
      description: "Lampu meja minimalis untuk ruang kerja."
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO products (name, price, stock, category, image_url, description)
    VALUES (@name, @price, @stock, @category, @image_url, @description)
  `);

  const tx = db.transaction(() => seed.forEach(p => stmt.run(p)));
  tx();
}
seedIfEmpty();

// =============== HELPERS =================
function sanitizeText(input, maxLen = 2000) {
  if (input === undefined || input === null) return "";
  const str = String(input).trim();
  return str.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLen);
}

function isValidEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function shippingCost(method) {
  if (method === "REGULER") return 15000;
  if (method === "EXPRESS") return 30000;
  return null;
}

function genOrderCode() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `ORD-${y}${m}${day}-${rand}`;
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", "Basic realm=\"Admin\"");
    return res.status(401).json({ error: "Unauthorized" });
  }
  const base64 = auth.split(" ")[1];
  const [user, pass] = Buffer.from(base64, "base64").toString().split(":");
  if (user === (process.env.ADMIN_USER || "admin") && pass === (process.env.ADMIN_PASS || "admin123")) {
    return next();
  }
  res.setHeader("WWW-Authenticate", "Basic realm=\"Admin\"");
  return res.status(401).json({ error: "Unauthorized" });
}

// =============== API =================
// GET products (search/filter/sort)
app.get("/api/products", (req, res) => {
  const q = sanitizeText(req.query.q, 100);
  const category = sanitizeText(req.query.category, 50);
  const sort = sanitizeText(req.query.sort, 30);

  let where = "WHERE 1=1";
  const params = {};

  if (q) {
    where += " AND (name LIKE @q OR category LIKE @q)";
    params.q = `%${q}%`;
  }
  if (category && category !== "ALL") {
    where += " AND category = @category";
    params.category = category;
  }

  let orderBy = "ORDER BY created_at DESC";
  if (sort === "price_asc") orderBy = "ORDER BY price ASC";
  if (sort === "price_desc") orderBy = "ORDER BY price DESC";
  if (sort === "newest") orderBy = "ORDER BY created_at DESC";

  const rows = db.prepare(`
    SELECT id, name, price, stock, category, image_url, description, created_at
    FROM products
    ${where}
    ${orderBy}
    LIMIT 200
  `).all(params);

  res.json(rows);
});

// GET product detail
app.get("/api/products/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const row = db.prepare(`
    SELECT id, name, price, stock, category, image_url, description, created_at
    FROM products WHERE id = ?
  `).get(id);

  if (!row) return res.status(404).json({ error: "Product not found" });
  res.json(row);
});

// POST order (kirim data pembeli + item)
app.post("/api/orders", (req, res) => {
  try {
    const body = req.body || {};
    const customer = body.customer || {};
    const items = Array.isArray(body.items) ? body.items : [];

    const name = sanitizeText(customer.name, 100);
    const phone = sanitizeText(customer.phone, 30);
    const email = sanitizeText(customer.email, 120);
    const address = sanitizeText(customer.address, 300);
    const city = sanitizeText(customer.city, 80);
    const postal_code = sanitizeText(customer.postal_code, 12);

    const ship = sanitizeText(body.shipping_method, 20).toUpperCase();
    const pay = sanitizeText(body.payment_method, 20).toUpperCase();
    const notes = sanitizeText(body.notes, 500);

    if (!name || !phone || !address || !city || !postal_code) {
      return res.status(400).json({ error: "Lengkapi data pembeli wajib." });
    }
    if (!isValidEmail(email)) return res.status(400).json({ error: "Format email tidak valid." });

    const shipCost = shippingCost(ship);
    if (shipCost === null) return res.status(400).json({ error: "Metode pengiriman tidak valid." });

    if (!["COD", "TRANSFER"].includes(pay)) {
      return res.status(400).json({ error: "Metode pembayaran tidak valid." });
    }

    if (!items.length) return res.status(400).json({ error: "Keranjang kosong." });

    const productStmt = db.prepare(`SELECT id, name, price, stock FROM products WHERE id = ?`);

    const normalized = items.map(it => ({
      product_id: Number(it.product_id),
      qty: Number(it.qty)
    }));

    let subtotal = 0;

    for (const it of normalized) {
      if (!Number.isInteger(it.product_id) || !Number.isInteger(it.qty) || it.qty <= 0) {
        return res.status(400).json({ error: "Item keranjang tidak valid." });
      }
      const p = productStmt.get(it.product_id);
      if (!p) return res.status(400).json({ error: `Produk id ${it.product_id} tidak ditemukan.` });
      if (p.stock < it.qty) return res.status(400).json({ error: `Stok tidak cukup untuk ${p.name}.` });
      subtotal += p.price * it.qty;
    }

    const total = subtotal + shipCost;
    const order_code = genOrderCode();

    const insertCustomer = db.prepare(`
      INSERT INTO customers (name, phone, email, address, city, postal_code)
      VALUES (@name, @phone, @email, @address, @city, @postal_code)
    `);
    const insertOrder = db.prepare(`
      INSERT INTO orders (order_code, customer_id, shipping_method, shipping_cost, payment_method, notes, subtotal, total)
      VALUES (@order_code, @customer_id, @shipping_method, @shipping_cost, @payment_method, @notes, @subtotal, @total)
    `);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, name_snapshot, price_snapshot, qty, line_total)
      VALUES (@order_id, @product_id, @name_snapshot, @price_snapshot, @qty, @line_total)
    `);
    const updateStock = db.prepare(`
      UPDATE products SET stock = stock - @qty WHERE id = @product_id
    `);

    const tx = db.transaction(() => {
      const customer_id = insertCustomer.run({
        name,
        phone,
        email: email || null,
        address,
        city,
        postal_code
      }).lastInsertRowid;

      const order_id = insertOrder.run({
        order_code,
        customer_id,
        shipping_method: ship,
        shipping_cost: shipCost,
        payment_method: pay,
        notes: notes || null,
        subtotal,
        total
      }).lastInsertRowid;

      for (const it of normalized) {
        const p = productStmt.get(it.product_id);
        insertItem.run({
          order_id,
          product_id: p.id,
          name_snapshot: p.name,
          price_snapshot: p.price,
          qty: it.qty,
          line_total: p.price * it.qty
        });
        updateStock.run({ product_id: p.id, qty: it.qty });
      }

      return { order_id, order_code, total };
    });

    const result = tx();
    res.status(201).json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error saat membuat pesanan." });
  }
});

// Admin: GET order detail by id
app.get("/api/admin/orders/:id", adminAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const order = db.prepare(`
    SELECT o.*, c.name AS customer_name, c.phone, c.email, c.address, c.city, c.postal_code
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(id);

  if (!order) return res.status(404).json({ error: "Order not found" });

  const items = db.prepare(`
    SELECT product_id, name_snapshot, price_snapshot, qty, line_total
    FROM order_items
    WHERE order_id = ?
  `).all(id);

  res.json({ order, items });
});

// =============== FRONTEND (ONE PAGE APP) =================
app.get("/", (req, res) => {
  res.type("html").send(HTML);
});

// =============== START =================
app.listen(PORT, () => {
  console.log(`✅ Jalan: http://localhost:${PORT}`);
  console.log(`✅ Admin cek order: /admin (di dalam web)`);
});

const HTML = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Toko Online (1 File)</title>
<style>
:root{
  --bg:#0b1220; --stroke:rgba(255,255,255,.14);
  --card:rgba(255,255,255,.06); --text:#eaf0ff; --muted:rgba(234,240,255,.72);
  --accent:#7c5cff; --ok:#22c55e; --danger:#ef4444;
  --radius:18px; --shadow:0 18px 55px rgba(0,0,0,.35); --max:1100px;
}
*{box-sizing:border-box}
body{
  margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--text);
  background:
    radial-gradient(1000px 700px at 20% -10%, rgba(124,92,255,.35), transparent 60%),
    radial-gradient(900px 600px at 90% 0%, rgba(34,197,94,.22), transparent 55%),
    var(--bg);
}
a{color:inherit;text-decoration:none}
.container{max-width:var(--max); margin:0 auto; padding:18px;}
.nav{
  position:sticky; top:0; z-index:10;
  backdrop-filter: blur(10px);
  background: rgba(11,18,32,.65);
  border-bottom:1px solid var(--stroke);
}
.nav-inner{display:flex; align-items:center; justify-content:space-between; gap:12px;}
.brand{display:flex; align-items:center; gap:10px; font-weight:900; letter-spacing:.3px;}
.dot{width:10px;height:10px;border-radius:50%;background:var(--accent);display:inline-block}
.badge{
  font-size:12px; padding:4px 10px; border-radius:999px;
  background: rgba(124,92,255,.18);
  border:1px solid rgba(124,92,255,.35);
}
.nav-links{display:flex; gap:10px; flex-wrap:wrap; align-items:center;}
.btn{
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:10px 14px; border-radius:12px; border:1px solid var(--stroke);
  background: rgba(255,255,255,.06); color:var(--text); cursor:pointer;
}
.btn:hover{transform: translateY(-1px)}
.btn.primary{background: linear-gradient(135deg, rgba(124,92,255,.95), rgba(124,92,255,.55)); border-color: rgba(124,92,255,.55);}
.btn.success{background: linear-gradient(135deg, rgba(34,197,94,.95), rgba(34,197,94,.45)); border-color: rgba(34,197,94,.55);}
.btn.danger{background: rgba(239,68,68,.16); border-color: rgba(239,68,68,.35);}
.hero{
  margin-top:18px; padding:18px; border-radius:var(--radius);
  background: rgba(255,255,255,.06); border:1px solid var(--stroke); box-shadow:var(--shadow);
}
.hero h1{margin:0 0 6px; font-size:28px}
.hero p{margin:0; color:var(--muted); line-height:1.55}
.toolbar{margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;}
.input, select, textarea{
  width:100%; padding:11px 12px; border-radius:12px; border:1px solid var(--stroke);
  background: rgba(255,255,255,.06); color: var(--text); outline:none;
}
textarea{min-height:90px; resize:vertical}
label{font-size:12px; color:var(--muted)}
.grid{margin-top:16px; display:grid; grid-template-columns: repeat(12,1fr); gap:14px;}
.card{
  grid-column: span 4;
  background: rgba(255,255,255,.06);
  border:1px solid var(--stroke);
  border-radius: var(--radius);
  overflow:hidden;
  box-shadow: var(--shadow);
  display:flex; flex-direction:column;
}
.card img{width:100%; height:170px; object-fit:cover}
.card .content{padding:12px}
.card .title{font-weight:900; margin:0 0 6px}
.card .meta{display:flex; justify-content:space-between; gap:8px; color:var(--muted); font-size:13px}
.card .actions{padding:12px; padding-top:0; display:flex; gap:10px}
.card .actions .btn{flex:1}
.panel{
  margin-top:16px; padding:16px; border-radius:var(--radius);
  background: rgba(255,255,255,.06); border:1px solid var(--stroke); box-shadow:var(--shadow);
}
.table{width:100%; border-collapse:collapse}
.table th,.table td{padding:10px; border-bottom:1px solid var(--stroke); text-align:left; vertical-align:top}
.table th{color:var(--muted); font-weight:800; font-size:13px}
.small{color:var(--muted); font-size:13px}
.hr{height:1px;background:var(--stroke); margin:14px 0}
.row{display:grid; grid-template-columns:1fr 1fr; gap:12px}
.row3{display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px}
.hidden{display:none !important}
@media(max-width:900px){ .card{grid-column: span 6;} }
@media(max-width:620px){ .card{grid-column: span 12;} .row,.row3{grid-template-columns:1fr;} }
</style>
</head>
<body>
<div class="nav">
  <div class="container nav-inner">
    <a class="brand" href="#/"><span class="dot"></span> Toko Modern <span class="badge">1 File</span></a>
    <div class="nav-links">
      <a class="btn" href="#/">Katalog</a>
      <a class="btn" href="#/cart">Keranjang <span class="badge" id="cartBadge">0</span></a>
      <a class="btn" href="#/admin">Admin</a>
    </div>
  </div>
</div>

<div class="container">
  <div id="view"></div>
</div>

<script>
/* ========= STORE (localStorage cart) ========= */
const CART_KEY = "TOKO_CART_ONEFILE_V1";

function rupiah(n){
  return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR"}).format(n);
}
function loadCart(){
  try{ return JSON.parse(localStorage.getItem(CART_KEY)||"[]"); }catch{ return []; }
}
function saveCart(cart){ localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function cartCount(cart){ return cart.reduce((a,it)=>a+it.qty,0); }
function setCartBadge(){
  const cart = loadCart();
  document.getElementById("cartBadge").textContent = cartCount(cart);
}
function addToCart(p, qty=1){
  const cart = loadCart();
  const found = cart.find(i=>i.id===p.id);
  if(found) found.qty += qty;
  else cart.push({ id:p.id, name:p.name, price:p.price, image_url:p.image_url, qty });
  saveCart(cart); setCartBadge();
}
function updateQty(id, qty){
  const cart = loadCart().map(it => it.id===id ? ({...it, qty}) : it).filter(it=>it.qty>0);
  saveCart(cart); setCartBadge(); return cart;
}
function removeItem(id){
  const cart = loadCart().filter(it=>it.id!==id);
  saveCart(cart); setCartBadge(); return cart;
}
function clearCart(){ saveCart([]); setCartBadge(); }
function subtotal(cart){ return cart.reduce((a,it)=>a + it.price*it.qty, 0); }

/* ========= API ========= */
const API = {
  async getProducts(params={}){
    const usp = new URLSearchParams(params);
    const r = await fetch("/api/products?"+usp.toString());
    if(!r.ok) throw new Error("Gagal mengambil produk.");
    return r.json();
  },
  async getProduct(id){
    const r = await fetch("/api/products/"+id);
    if(!r.ok) throw new Error("Produk tidak ditemukan.");
    return r.json();
  },
  async createOrder(payload){
    const r = await fetch("/api/orders",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error || "Gagal membuat pesanan.");
    return d;
  },
  async adminGetOrder(id, basicHeader){
    const r = await fetch("/api/admin/orders/"+id, { headers:{ "Authorization": basicHeader }});
    const d = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error || "Gagal akses admin.");
    return d;
  }
};

function html(str){ return str; }

/* ========= ROUTER ========= */
window.addEventListener("hashchange", render);
window.addEventListener("load", () => { setCartBadge(); render(); });

function route(){
  const h = location.hash || "#/";
  const [path, queryStr] = h.replace("#","").split("?");
  const q = new URLSearchParams(queryStr||"");
  return { path, q };
}

async function render(){
  const { path, q } = route();
  const view = document.getElementById("view");

  if(path === "/") return renderCatalog(view);
  if(path === "/p") return renderDetail(view, q.get("id"));
  if(path === "/cart") return renderCart(view);
  if(path === "/checkout") return renderCheckout(view);
  if(path === "/success") return renderSuccess(view);
  if(path === "/admin") return renderAdmin(view);

  location.hash = "#/";
}

/* ========= VIEWS ========= */
async function renderCatalog(view){
  view.innerHTML = html(\`
    <div class="hero">
      <h1>Katalog Produk</h1>
      <p>Cari produk, filter kategori, urutkan harga, lalu checkout. Data pembeli & pesanan akan tersimpan di database (SQLite).</p>
      <div class="toolbar">
        <input id="q" class="input" placeholder="Cari produk / kategori...">
        <select id="category" class="input"><option value="ALL">Semua</option></select>
        <select id="sort" class="input">
          <option value="newest">Terbaru</option>
          <option value="price_asc">Termurah</option>
          <option value="price_desc">Termahal</option>
        </select>
      </div>
    </div>
    <div id="msg" class="small" style="margin-top:12px"></div>
    <div id="grid" class="grid"></div>
  \`);

  const qEl = document.getElementById("q");
  const catEl = document.getElementById("category");
  const sortEl = document.getElementById("sort");
  const grid = document.getElementById("grid");
  const msg = document.getElementById("msg");

  // isi kategori dari seluruh data
  try{
    const all = await API.getProducts({ sort:"newest" });
    const cats = Array.from(new Set(all.map(p=>p.category))).sort();
    catEl.innerHTML = '<option value="ALL">Semua</option>' + cats.map(c=>\`<option value="\${c}">\${c}</option>\`).join("");
  }catch{}

  async function refresh(){
    msg.textContent = "Memuat produk...";
    grid.innerHTML = "";

    try{
      const products = await API.getProducts({
        q: qEl.value.trim(),
        category: catEl.value,
        sort: sortEl.value
      });

      msg.textContent = products.length ? "" : "Produk tidak ditemukan.";
      grid.innerHTML = products.map(p => {
        const stockLabel = p.stock>0 ? \`\${p.stock} tersedia\` : "Habis";
        const disabled = p.stock>0 ? "" : "disabled";
        return \`
          <div class="card">
            <img src="\${p.image_url}" alt="\${p.name}">
            <div class="content">
              <div class="title">\${p.name}</div>
              <div class="meta"><div>\${p.category}</div><div>\${stockLabel}</div></div>
              <div style="margin-top:10px;font-weight:900">\${rupiah(p.price)}</div>
            </div>
            <div class="actions">
              <a class="btn" href="#/p?id=\${p.id}">Detail</a>
              <button class="btn primary" data-add="\${p.id}" \${disabled}>Tambah</button>
            </div>
          </div>\`;
      }).join("");

      grid.querySelectorAll("[data-add]").forEach(btn => {
        btn.addEventListener("click", ()=>{
          const id = Number(btn.getAttribute("data-add"));
          const p = products.find(x=>x.id===id);
          if(!p) return;
          addToCart(p,1);
          btn.textContent = "✓ Ditambah";
          setTimeout(()=>btn.textContent="Tambah", 800);
        });
      });

    }catch(e){
      msg.textContent = e.message;
    }
  }

  qEl.addEventListener("input", ()=>{
    clearTimeout(window.__t);
    window.__t = setTimeout(refresh, 250);
  });
  catEl.addEventListener("change", refresh);
  sortEl.addEventListener("change", refresh);

  refresh();
}

async function renderDetail(view, id){
  id = Number(id);
  view.innerHTML = '<div class="panel">Memuat...</div>';
  try{
    const p = await API.getProduct(id);
    view.innerHTML = html(\`
      <div class="panel">
        <div class="row">
          <div>
            <img src="\${p.image_url}" alt="\${p.name}"
              style="width:100%;border-radius:16px;border:1px solid var(--stroke);">
          </div>
          <div>
            <h2 style="margin-top:0">\${p.name}</h2>
            <div class="small">Kategori: <b>\${p.category}</b></div>
            <div class="small">Stok: <b>\${p.stock}</b></div>
            <div style="margin:12px 0;font-size:22px;font-weight:900">\${rupiah(p.price)}</div>
            <p class="small" style="line-height:1.65">\${p.description}</p>
            <div class="hr"></div>
            <div class="row3">
              <div>
                <label>Qty</label>
                <input id="qty" class="input" type="number" min="1" value="1">
              </div>
              <div style="display:flex;align-items:end">
                <button id="btnAdd" class="btn primary" style="width:100%" \${p.stock<=0?"disabled":""}>
                  Tambah ke Keranjang
                </button>
              </div>
              <div style="display:flex;align-items:end">
                <a class="btn" style="width:100%" href="#/cart">Lihat Keranjang</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    \`);
    document.getElementById("btnAdd").addEventListener("click", ()=>{
      const qty = Math.max(1, Math.min(p.stock, Number(document.getElementById("qty").value)||1));
      addToCart(p, qty);
      alert("Produk ditambahkan ke keranjang.");
    });
  }catch(e){
    view.innerHTML = '<div class="panel">'+e.message+'</div>';
  }
}

function renderCart(view){
  const cart = loadCart();
  view.innerHTML = html(\`
    <div class="hero">
      <h1>Keranjang</h1>
      <p>Qty bisa diubah, total otomatis. Keranjang tersimpan di localStorage.</p>
    </div>

    <div id="empty" class="panel \${cart.length ? "hidden":""}">
      Keranjang masih kosong. <a class="btn primary" href="#/">Belanja sekarang</a>
    </div>

    <div class="panel \${cart.length ? "":"hidden"}" id="cartPanel">
      <table class="table">
        <thead>
          <tr><th></th><th>Produk</th><th>Qty</th><th>Subtotal</th><th>Aksi</th></tr>
        </thead>
        <tbody id="tbody"></tbody>
      </table>

      <div class="hr"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div class="small">Subtotal</div>
        <div style="font-weight:900;font-size:18px" id="sub"></div>
      </div>

      <div class="hr"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
        <a class="btn" href="#/">Lanjut Belanja</a>
        <a class="btn success" href="#/checkout">Checkout</a>
      </div>
    </div>
  \`);

  function redraw(){
    const cart2 = loadCart();
    const tbody = document.getElementById("tbody");
    const sub = document.getElementById("sub");

    if(!cart2.length){
      location.hash = "#/cart";
      return;
    }

    tbody.innerHTML = cart2.map(it=>\`
      <tr>
        <td style="width:80px">
          <img src="\${it.image_url}" alt="\${it.name}"
            style="width:70px;height:55px;object-fit:cover;border-radius:10px;border:1px solid var(--stroke)">
        </td>
        <td>
          <b>\${it.name}</b><br><span class="small">\${rupiah(it.price)}</span>
        </td>
        <td style="width:180px">
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn" data-dec="\${it.id}">-</button>
            <input class="input" style="width:70px" type="number" min="1" value="\${it.qty}" data-qty="\${it.id}">
            <button class="btn" data-inc="\${it.id}">+</button>
          </div>
        </td>
        <td style="width:150px"><b>\${rupiah(it.price*it.qty)}</b></td>
        <td style="width:120px"><button class="btn danger" data-del="\${it.id}">Hapus</button></td>
      </tr>\`).join("");

    sub.textContent = rupiah(subtotal(cart2));

    tbody.querySelectorAll("[data-inc]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const id = Number(b.getAttribute("data-inc"));
        const item = cart2.find(x=>x.id===id);
        updateQty(id, item.qty+1); redraw();
      });
    });
    tbody.querySelectorAll("[data-dec]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const id = Number(b.getAttribute("data-dec"));
        const item = cart2.find(x=>x.id===id);
        updateQty(id, Math.max(1,item.qty-1)); redraw();
      });
    });
    tbody.querySelectorAll("[data-qty]").forEach(inp=>{
      inp.addEventListener("change", ()=>{
        const id = Number(inp.getAttribute("data-qty"));
        const qty = Math.max(1, Number(inp.value)||1);
        updateQty(id, qty); redraw();
      });
    });
    tbody.querySelectorAll("[data-del]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const id = Number(b.getAttribute("data-del"));
        removeItem(id); redraw();
      });
    });
  }

  redraw();
}

function renderCheckout(view){
  const cart = loadCart();
  if(!cart.length){
    view.innerHTML = '<div class="panel">Keranjang kosong. <a class="btn primary" href="#/">Kembali</a></div>';
    return;
  }

  view.innerHTML = html(\`
    <div class="hero">
      <h1>Checkout</h1>
      <p>Isi data pembeli, pilih pengiriman & pembayaran. Data akan masuk database.</p>
    </div>

    <div class="grid">
      <div class="panel" style="grid-column: span 7;">
        <form id="form">
          <div class="row">
            <div><label>Nama *</label><input id="name" class="input" required></div>
            <div><label>No HP/WhatsApp *</label><input id="phone" class="input" required></div>
          </div>

          <div class="row">
            <div><label>Email (opsional)</label><input id="email" class="input" placeholder="contoh@mail.com"></div>
            <div><label>Kode Pos *</label><input id="postal" class="input" required></div>
          </div>

          <div class="row">
            <div><label>Kota *</label><input id="city" class="input" required></div>
            <div>
              <label>Pengiriman *</label>
              <select id="ship" class="input">
                <option value="REGULER">Reguler (Rp15.000)</option>
                <option value="EXPRESS">Express (Rp30.000)</option>
              </select>
            </div>
          </div>

          <div class="row">
            <div>
              <label>Pembayaran *</label>
              <select id="pay" class="input">
                <option value="COD">COD</option>
                <option value="TRANSFER">Transfer</option>
              </select>
            </div>
            <div></div>
          </div>

          <div><label>Alamat Lengkap *</label><textarea id="address" class="input" required></textarea></div>
          <div><label>Catatan (opsional)</label><textarea id="notes" class="input" placeholder="Contoh: titip ke satpam."></textarea></div>

          <div class="hr"></div>
          <button class="btn success" style="width:100%" id="btn" type="submit">Buat Pesanan</button>
          <div id="msg" class="small" style="margin-top:10px"></div>
        </form>
      </div>

      <div class="panel" style="grid-column: span 5;">
        <h3 style="margin-top:0">Ringkasan</h3>
        <div id="items"></div>
        <div class="hr"></div>
        <div style="display:flex;justify-content:space-between"><span class="small">Subtotal</span><b id="sumSub"></b></div>
        <div style="display:flex;justify-content:space-between"><span class="small">Ongkir</span><b id="sumShip"></b></div>
        <div class="hr"></div>
        <div style="display:flex;justify-content:space-between"><span class="small">Total</span><b id="sumTotal"></b></div>
        <div class="hr"></div>
        <a class="btn" href="#/cart" style="width:100%">Kembali ke Keranjang</a>
      </div>
    </div>
  \`);

  function shipCost(method){ return method==="REGULER"?15000: method==="EXPRESS"?30000:0; }

  function renderSummary(){
    const cart = loadCart();
    const sub = subtotal(cart);
    const ship = shipCost(document.getElementById("ship").value);
    const total = sub + ship;

    document.getElementById("items").innerHTML = cart.map(it=>\`
      <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--stroke)">
        <div><b>\${it.name}</b><div class="small">\${it.qty} x \${rupiah(it.price)}</div></div>
        <div><b>\${rupiah(it.qty*it.price)}</b></div>
      </div>\`).join("");

    document.getElementById("sumSub").textContent = rupiah(sub);
    document.getElementById("sumShip").textContent = rupiah(ship);
    document.getElementById("sumTotal").textContent = rupiah(total);
  }

  document.getElementById("ship").addEventListener("change", renderSummary);
  renderSummary();

  document.getElementById("form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const cart = loadCart();
    if(!cart.length) return alert("Keranjang kosong.");

    const btn = document.getElementById("btn");
    const msg = document.getElementById("msg");
    btn.disabled = true;
    msg.textContent = "Mengirim pesanan...";

    try{
      const payload = {
        customer: {
          name: document.getElementById("name").value,
          phone: document.getElementById("phone").value,
          email: document.getElementById("email").value,
          address: document.getElementById("address").value,
          city: document.getElementById("city").value,
          postal_code: document.getElementById("postal").value
        },
        shipping_method: document.getElementById("ship").value,
        payment_method: document.getElementById("pay").value,
        notes: document.getElementById("notes").value,
        items: cart.map(it => ({ product_id: it.id, qty: it.qty }))
      };

      const res = await API.createOrder(payload);
      sessionStorage.setItem("LAST_ORDER", JSON.stringify(res));
      clearCart();
      location.hash = "#/success";
    }catch(err){
      msg.textContent = err.message;
    }finally{
      btn.disabled = false;
    }
  });
}

function renderSuccess(view){
  const raw = sessionStorage.getItem("LAST_ORDER");
  if(!raw){
    view.innerHTML = '<div class="panel">Tidak ada data order. <a class="btn primary" href="#/">Kembali</a></div>';
    return;
  }
  const d = JSON.parse(raw);
  view.innerHTML = html(\`
    <div class="panel">
      <h2 style="margin-top:0">Terima kasih, pesanan diterima ✅</h2>
      <p class="small">Simpan nomor pesanan ini untuk konfirmasi.</p>
      <div class="hr"></div>
      <div class="row3">
        <div><div class="small">Order Code</div><div style="font-weight:900;font-size:18px">\${d.order_code}</div></div>
        <div><div class="small">Total</div><div style="font-weight:900;font-size:18px">\${rupiah(d.total)}</div></div>
        <div style="display:flex;align-items:end"><a class="btn primary" style="width:100%" href="#/">Belanja Lagi</a></div>
      </div>
      <div class="hr"></div>
      <div class="small">Catatan: untuk produksi, pembayaran sebaiknya pakai payment gateway (Midtrans/Xendit) + ongkir API.</div>
    </div>\`);
}

function renderAdmin(view){
  view.innerHTML = html(\`
    <div class="hero">
      <h1>Admin - Cek Pesanan</h1>
      <p>Masukkan Order ID dan kredensial admin. Ini basic auth untuk demo.</p>
    </div>

    <div class="panel">
      <div class="row3">
        <div><label>Order ID</label><input id="oid" class="input" type="number" value="1"></div>
        <div><label>Admin User</label><input id="user" class="input" value="admin"></div>
        <div><label>Admin Pass</label><input id="pass" class="input" type="password" value="admin123"></div>
      </div>
      <div class="hr"></div>
      <button class="btn primary" id="btn">Ambil Data Order</button>
      <div id="out" class="small" style="margin-top:12px"></div>
    </div>
  \`);

  function basicHeader(u,p){ return "Basic " + btoa(u+":"+p); }

  document.getElementById("btn").addEventListener("click", async ()=>{
    const out = document.getElementById("out");
    out.textContent = "Memuat...";
    try{
      const id = Number(document.getElementById("oid").value);
      const u = document.getElementById("user").value;
      const p = document.getElementById("pass").value;

      const data = await API.adminGetOrder(id, basicHeader(u,p));
      const o = data.order;

      out.innerHTML = \`
        <div class="hr"></div>
        <div><b>\${o.order_code}</b> — <span class="small">\${o.created_at}</span></div>
        <div class="small">Customer: <b>\${o.customer_name}</b> | \${o.phone} | \${o.email || "-"}</div>
        <div class="small">Alamat: \${o.address}, \${o.city} \${o.postal_code}</div>
        <div class="small">Shipping: \${o.shipping_method} (\${rupiah(o.shipping_cost)}) | Pay: \${o.payment_method}</div>
        <div class="hr"></div>
        <table class="table">
          <thead><tr><th>Produk</th><th>Harga</th><th>Qty</th><th>Total</th></tr></thead>
          <tbody>
            \${data.items.map(it=>\`
              <tr>
                <td>\${it.name_snapshot}</td>
                <td>\${rupiah(it.price_snapshot)}</td>
                <td>\${it.qty}</td>
                <td><b>\${rupiah(it.line_total)}</b></td>
              </tr>\`).join("")}
          </tbody>
        </table>
        <div class="hr"></div>
        <div class="row3">
          <div><div class="small">Subtotal</div><b>\${rupiah(o.subtotal)}</b></div>
          <div><div class="small">Ongkir</div><b>\${rupiah(o.shipping_cost)}</b></div>
          <div><div class="small">Grand Total</div><b>\${rupiah(o.total)}</b></div>
        </div>
      \`;
    }catch(e){
      out.textContent = e.message;
    }
  });
}
</script>
</body>
</html>`;
