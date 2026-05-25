/**
 * Seed demo users, vendor account, categories, system settings, and Gorce vendor mock data.
 * Run: npm run db:seed
 */
import bcrypt from 'bcryptjs'
import pg from 'pg'

const { Pool } = pg

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/consignment'

const DEMO_BATCH = 'demo-gorce'
const DEMO_SKU_PREFIX = 'GORCE-DEMO-'

const demoUsers = [
  { email: 'admin@example.com', password: 'password123', role: 'admin' },
  { email: 'gorce@vendor.com', password: 'password123', role: 'vendor' },
]

const defaultCategories = ['Beverages', 'Snacks', 'Personal Care', 'Household']

const demoProducts = [
  { sku: '001', name: 'Gorce Mango Drink 500ml', category: 'Beverages', vendor_price: 8, markup: 2, packaging: '500ml' },
  { sku: '002', name: 'Gorce Ginger Ale 330ml', category: 'Beverages', vendor_price: 4, markup: 1, packaging: '330ml' },
  { sku: '003', name: 'Gorce Plantain Chips 150g', category: 'Snacks', vendor_price: 5, markup: 1.5, packaging: '150g' },
  { sku: '004', name: 'Gorce Mixed Nuts 200g', category: 'Snacks', vendor_price: 9, markup: 2.5, packaging: '200g' },
  { sku: '005', name: 'Gorce Shea Body Lotion 400ml', category: 'Personal Care', vendor_price: 12, markup: 3, packaging: '400ml' },
  { sku: '006', name: 'Gorce Dish Soap 750ml', category: 'Household', vendor_price: 6, markup: 2, packaging: '750ml' },
]

function formatDate(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(d, days) {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

/** Monday–Sunday week range, `weeksAgo` = 0 for current week. */
function weekRange(weeksAgo = 0) {
  const today = new Date()
  const dow = today.getDay()
  const toMonday = dow === 0 ? -6 : 1 - dow
  const monday = addDays(today, toMonday - weeksAgo * 7)
  const sunday = addDays(monday, 6)
  return { week_start: formatDate(monday), week_end: formatDate(sunday) }
}

async function clearGorceDemoData(client, vendorId) {
  await client.query(
    `
    delete from public.sales s
    using public.products p
    where s.product_id = p.id and p.vendor_id = $1::uuid and p.sku like $2
    `,
    [vendorId, `${DEMO_SKU_PREFIX}%`]
  )
  await client.query(
    `
    delete from public.product_returns r
    using public.products p
    where r.product_id = p.id and p.vendor_id = $1::uuid and p.sku like $2
    `,
    [vendorId, `${DEMO_SKU_PREFIX}%`]
  )
  await client.query(
    `
    delete from public.delivery_run_items dri
    using public.products p, public.delivery_runs dr
    where dri.product_id = p.id and dri.delivery_run_id = dr.id
      and p.vendor_id = $1::uuid and p.sku like $2 and dr.notes = $3
    `,
    [vendorId, `${DEMO_SKU_PREFIX}%`, DEMO_BATCH]
  )
  await client.query(
    `delete from public.delivery_runs where notes = $1`,
    [DEMO_BATCH]
  )
  await client.query(
    `
    delete from public.supermarket_inventory si
    using public.products p
    where si.product_id = p.id and p.vendor_id = $1::uuid and p.sku like $2
    `,
    [vendorId, `${DEMO_SKU_PREFIX}%`]
  )
  await client.query(
    `
    delete from public.intakes i
    using public.products p
    where i.product_id = p.id and p.vendor_id = $1::uuid and i.reference = $2
    `,
    [vendorId, DEMO_BATCH]
  )
  await client.query(
    `delete from public.payouts where vendor_id = $1::uuid and momo_txn_id like 'DEMO-%'`,
    [vendorId]
  )
  await client.query(
    `delete from public.vendor_deductions where vendor_id = $1::uuid and reason like '[demo]%'`,
    [vendorId]
  )
  await client.query(
    `delete from public.products where vendor_id = $1::uuid and sku like $2`,
    [vendorId, `${DEMO_SKU_PREFIX}%`]
  )
}

async function seedGorceDemoData(client, vendorId, adminUserId) {
  await clearGorceDemoData(client, vendorId)

  const expiry = formatDate(addDays(new Date(), 365))
  await client.query(
    `
    update public.vendors
    set
      status = 'active',
      verified_at = coalesce(verified_at, now()),
      facility_expiry_date = $2::date,
      fda_certificate_path = coalesce(fda_certificate_path, 'demo/gorce-fda-certificate.pdf'),
      description = 'Demo vendor — sample products, sales, deliveries, payouts, and returns for showcasing every module.',
      updated_at = now()
    where id = $1::uuid
    `,
    [vendorId, expiry]
  )

  const smRes = await client.query(
    `
    select id, name from public.supermarkets
    where deleted_at is null
    order by name
    limit 5
    `
  )
  if (smRes.rows.length < 2) {
    await client.query(
      `
      insert into public.supermarkets (name, location) values
        ('Accra Mall Shoprite', 'Accra, Greater Accra'),
        ('West Hills Mall', 'Weija, Greater Accra'),
        ('Marina Mall', 'Airport City, Accra')
      on conflict do nothing
      `
    )
  }
  const { rows: supermarkets } = await client.query(
    `select id, name from public.supermarkets where deleted_at is null order by name limit 5`
  )
  if (!supermarkets.length) throw new Error('No supermarkets — run migrations first')

  const productIds = []
  for (const dp of demoProducts) {
    const selling = dp.vendor_price + dp.markup
    const res = await client.query(
      `
      insert into public.products (
        name, vendor_id, selling_price, commission_percent,
        vendor_price, distrogh_markup, sku, category, packaging_size, moq, expiry_date
      )
      values ($1, $2::uuid, $3, 0, $4, $5, $6, $7, $8, 1, $9::date)
      returning id
      `,
      [
        dp.name,
        vendorId,
        selling,
        dp.vendor_price,
        dp.markup,
        `${DEMO_SKU_PREFIX}${dp.sku}`,
        dp.category,
        dp.packaging,
        formatDate(addDays(new Date(), 180 + parseInt(dp.sku, 10) * 14)),
      ]
    )
    productIds.push({ id: res.rows[0].id, ...dp, selling })
  }

  const intakeQty = [400, 350, 280, 220, 180, 300]
  const intakeDateEarly = formatDate(addDays(new Date(), -21))
  const intakeDateRecent = formatDate(addDays(new Date(), -7))
  for (let i = 0; i < productIds.length; i++) {
    const p = productIds[i]
    await client.query(
      `
      insert into public.intakes (vendor_id, product_id, quantity_received, received_date, reference)
      values ($1::uuid, $2::uuid, $3, $4::date, $5)
      `,
      [vendorId, p.id, intakeQty[i], intakeDateEarly, DEMO_BATCH]
    )
    await client.query(
      `
      insert into public.intakes (vendor_id, product_id, quantity_received, received_date, reference)
      values ($1::uuid, $2::uuid, $3, $4::date, $5)
      `,
      [vendorId, p.id, Math.floor(intakeQty[i] * 0.35), intakeDateRecent, DEMO_BATCH]
    )
  }

  const deliveryPlans = [
    { sm: 0, daysAgo: 14, transport: 45, items: [{ pi: 0, qty: 80 }, { pi: 1, qty: 60 }] },
    { sm: 1, daysAgo: 10, transport: 38, items: [{ pi: 2, qty: 70 }, { pi: 3, qty: 50 }] },
    { sm: 2, daysAgo: 5, transport: 52, items: [{ pi: 4, qty: 40 }, { pi: 5, qty: 90 }, { pi: 0, qty: 30 }] },
    { sm: 0, daysAgo: 3, transport: 30, items: [{ pi: 1, qty: 45 }, { pi: 5, qty: 35 }] },
  ]

  for (const plan of deliveryPlans) {
    const sm = supermarkets[plan.sm % supermarkets.length]
    const deliveryDate = formatDate(addDays(new Date(), -plan.daysAgo))
    const runRes = await client.query(
      `
      insert into public.delivery_runs (
        supermarket_id, delivery_date, total_transport_cost, notes,
        confirmed_at, confirmed_by
      )
      values ($1::uuid, $2::date, $3, $4, now() - make_interval(days => $5::int), $6::uuid)
      returning id
      `,
      [sm.id, deliveryDate, plan.transport, DEMO_BATCH, plan.daysAgo, adminUserId]
    )
    const runId = runRes.rows[0].id
    for (const item of plan.items) {
      const p = productIds[item.pi]
      await client.query(
        `
        insert into public.delivery_run_items (delivery_run_id, product_id, quantity_delivered)
        values ($1::uuid, $2::uuid, $3)
        on conflict (delivery_run_id, product_id) do update
        set quantity_delivered = excluded.quantity_delivered
        `,
        [runId, p.id, item.qty]
      )
      await client.query(
        `
        insert into public.supermarket_inventory (supermarket_id, product_id, quantity)
        values ($1::uuid, $2::uuid, $3)
        on conflict (supermarket_id, product_id) do update
        set quantity = public.supermarket_inventory.quantity + excluded.quantity,
            updated_at = now()
        `,
        [sm.id, p.id, item.qty]
      )
    }
  }

  const salesPatterns = [
    { weeksAgo: 7, sm: 0, pi: 0, qty: 42 },
    { weeksAgo: 7, sm: 1, pi: 1, qty: 38 },
    { weeksAgo: 7, sm: 0, pi: 2, qty: 55 },
    { weeksAgo: 6, sm: 2, pi: 3, qty: 28 },
    { weeksAgo: 6, sm: 1, pi: 4, qty: 22 },
    { weeksAgo: 6, sm: 0, pi: 5, qty: 48 },
    { weeksAgo: 5, sm: 2, pi: 0, qty: 35 },
    { weeksAgo: 5, sm: 1, pi: 1, qty: 41 },
    { weeksAgo: 5, sm: 0, pi: 3, qty: 19 },
    { weeksAgo: 4, sm: 2, pi: 2, qty: 62 },
    { weeksAgo: 4, sm: 1, pi: 4, qty: 15 },
    { weeksAgo: 4, sm: 0, pi: 5, qty: 33 },
    { weeksAgo: 3, sm: 2, pi: 0, qty: 28 },
    { weeksAgo: 3, sm: 1, pi: 2, qty: 44 },
    { weeksAgo: 3, sm: 0, pi: 5, qty: 27 },
    { weeksAgo: 2, sm: 2, pi: 1, qty: 36 },
    { weeksAgo: 2, sm: 1, pi: 3, qty: 24 },
    { weeksAgo: 2, sm: 0, pi: 4, qty: 18 },
    { weeksAgo: 1, sm: 2, pi: 0, qty: 31 },
    { weeksAgo: 1, sm: 1, pi: 2, qty: 39 },
    { weeksAgo: 1, sm: 0, pi: 5, qty: 22 },
    { weeksAgo: 0, sm: 0, pi: 0, qty: 26 },
    { weeksAgo: 0, sm: 1, pi: 1, qty: 29 },
    { weeksAgo: 0, sm: 2, pi: 3, qty: 17 },
    { weeksAgo: 0, sm: 0, pi: 4, qty: 12 },
  ]

  for (const sp of salesPatterns) {
    const p = productIds[sp.pi]
    const sm = supermarkets[sp.sm % supermarkets.length]
    const { week_start, week_end } = weekRange(sp.weeksAgo)
    const unit = p.selling
    const qty = sp.qty
    await client.query(
      `
      insert into public.sales (
        product_id, supermarket_id, qty_sold, unit_price,
        total_sales, commission_amount, vendor_due,
        week_start, week_end, import_batch_id
      )
      values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::date, $9::date, $10)
      `,
      [
        p.id,
        sm.id,
        qty,
        unit,
        Math.round(qty * unit * 100) / 100,
        Math.round(qty * p.markup * 100) / 100,
        Math.round(qty * p.vendor_price * 100) / 100,
        week_start,
        week_end,
        DEMO_BATCH,
      ]
    )
  }

  const returnRows = [
    { pi: 2, sm: 0, qty: 3, reason: 'expired', notes: 'Near expiry on shelf' },
    { pi: 0, sm: 1, qty: 2, reason: 'defective_packaging', notes: 'Damaged carton' },
    { pi: 5, sm: 2, qty: 1, reason: 'other', notes: 'Customer complaint — demo' },
  ]
  for (const r of returnRows) {
    const p = productIds[r.pi]
    const sm = supermarkets[r.sm % supermarkets.length]
    await client.query(
      `
      insert into public.product_returns (
        product_id, supermarket_id, quantity_returned, unit_price,
        reason, reason_notes, return_date
      )
      values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date)
      `,
      [p.id, sm.id, r.qty, p.selling, r.reason, r.notes, formatDate(addDays(new Date(), -12))]
    )
  }

  const w5 = weekRange(5)
  const w3 = weekRange(3)
  const w0 = weekRange(0)

  await client.query(
    `
    insert into public.payouts (
      vendor_id, amount_due, amount_paid, momo_txn_id, status,
      payout_date, week_start, week_end
    )
    values
      ($1::uuid, 420.00, 420.00, 'DEMO-TXN-001', 'completed', now() - interval '35 days', $2::date, $3::date),
      ($1::uuid, 385.50, 385.50, 'DEMO-TXN-002', 'completed', now() - interval '21 days', $4::date, $5::date),
      ($1::uuid, 290.00, 0, null, 'pending', null, $6::date, $7::date)
    `,
    [vendorId, w5.week_start, w5.week_end, w3.week_start, w3.week_end, w0.week_start, w0.week_end]
  )

  await client.query(
    `
    insert into public.vendor_deductions (vendor_id, amount, reason, deduction_date)
    values ($1::uuid, 25.00, '[demo] Transport cost adjustment — shared delivery run', $2::date)
    `,
    [vendorId, formatDate(addDays(new Date(), -20))]
  )

  console.log('  Gorce demo data: 6 products, intakes, 4 deliveries, 25 sales, 3 returns, 3 payouts, 1 deduction')
}

async function run() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    let adminUserId = null
    let vendorUserId = null
    for (const u of demoUsers) {
      const hash = await bcrypt.hash(u.password, 10)
      const res = await client.query(
        `
        insert into public.users (email, password_hash)
        values ($1, $2)
        on conflict (email) do update set password_hash = excluded.password_hash
        returning id
        `,
        [u.email.toLowerCase(), hash]
      )
      const userId = res.rows[0].id
      if (u.role === 'admin') adminUserId = userId
      if (u.role === 'vendor') vendorUserId = userId

      await client.query(
        `
        insert into public.profiles (user_id, role, vendor_id)
        values ($1, $2, null)
        on conflict (user_id) do update
        set role = excluded.role, updated_at = now()
        `,
        [userId, u.role]
      )
    }

    const existingVendor = await client.query(
      `select id from public.vendors where lower(login_email) = lower($1) and deleted_at is null limit 1`,
      ['gorce@vendor.com']
    )
    let vendorId = existingVendor.rows[0]?.id
    if (!vendorId) {
      const vendorRes = await client.query(
        `
        insert into public.vendors (
          name, momo_number, momo_network, default_commission,
          status, login_email, contact_phone, description
        )
        values (
          'Gorce Ltd', '0244123456', 'MTN', 10.00,
          'active', 'gorce@vendor.com', '0244123456',
          'Demo vendor account for local development'
        )
        returning id
        `
      )
      vendorId = vendorRes.rows[0]?.id
    }

    if (vendorId && vendorUserId) {
      await client.query(
        `
        update public.profiles
        set vendor_id = $2::uuid, role = 'vendor', updated_at = now()
        where user_id = $1::uuid
        `,
        [vendorUserId, vendorId]
      )
    }

    if (vendorId) {
      const paidAt = new Date()
      const expires = addDays(paidAt, 365)
      await client.query(
        `
        update public.vendors
        set
          service_charge_paid_at = now(),
          service_charge_expires_at = $2::date,
          updated_at = now()
        where id = $1::uuid
        `,
        [vendorId, formatDate(expires)]
      )
    }

    for (let i = 0; i < defaultCategories.length; i++) {
      await client.query(
        `
        insert into public.categories (name, sort_order)
        select $1, $2
        where not exists (
          select 1 from public.categories where lower(name) = lower($1)
        )
        `,
        [defaultCategories[i], i + 1]
      )
    }

    await client.query(
      `
      insert into public.system_settings (key, value)
      values ('app', $1::jsonb)
      on conflict (key) do update set value = excluded.value, updated_at = now()
      `,
      [
        JSON.stringify({
          company_name: 'DistroGH',
          default_moq: 1,
          expiry_reminder_days: 30,
          week_starts_on: 1,
          packaging_presets: ['100g', '250g', '400g', '500g', '1kg', '1L', '500ml'],
        }),
      ]
    )

    if (vendorId && adminUserId) {
      await seedGorceDemoData(client, vendorId, adminUserId)
    }

    await client.query('COMMIT')
    console.log('Seed complete.')
    console.log('  Admin:  admin@example.com / password123')
    console.log('  Vendor: gorce@vendor.com / password123')
    if (vendorId) console.log(`  Vendor id: ${vendorId}`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
