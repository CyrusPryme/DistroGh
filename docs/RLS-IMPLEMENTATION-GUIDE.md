# Vendor RLS Implementation Guide

## 🎯 Objective
Implement Row Level Security (RLS) to ensure vendors can only access their own data while admins maintain full system oversight.

## 📁 Files Created

### 1. `vendor-rls-migration.sql`
**Main migration script that:**
- Enables RLS on `products`, `sales`, `payouts` tables
- Creates isolation policies for vendor data
- Maintains admin full access
- Adds helper function for debugging

### 2. `test-vendor-rls.sql`
**Verification script that:**
- Tests RLS policy effectiveness
- Verifies vendor isolation
- Compares admin vs vendor data access
- Provides detailed audit output

### 3. `rollback-vendor-rls.sql`
**Emergency rollback script that:**
- Disables RLS on all tables
- Removes all policies
- Restores unrestricted access
- Useful for troubleshooting

## 🚀 Implementation Steps

### Step 1: Apply Migration
```sql
-- Run in Supabase SQL Editor
\i vendor-rls-migration.sql
```

### Step 2: Verify Implementation
```sql
-- Run verification script
\i test-vendor-rls.sql
```

### Step 3: Test with Different Users
1. **Admin User:** Should see all records
2. **Vendor User:** Should see only their records
3. **Regular User:** Should have limited access

## 🔐 Security Features

### Admin Access (Bypasses All Restrictions)
- Full CRUD operations on all tables
- Can see all vendors' data
- Maintains system oversight

### Vendor Access (Strict Isolation)
- **Products:** Only their own products
- **Sales:** Only sales of their products
- **Payouts:** Only their payout records
- **Insert/Update:** Only to their own records

### User Access (Limited)
- Can view payouts (if applicable)
- No access to vendor-specific data

## 📊 How It Works

### Policy Logic
```sql
-- Example: Sales isolation
EXISTS (
    SELECT 1 FROM profiles 
    JOIN vendors ON vendors.id = profiles.vendor_id
    JOIN products ON products.id = sales.product_id
    WHERE profiles.user_id = auth.uid() 
    AND profiles.role = 'vendor'
    AND vendors.id = products.vendor_id
)
```

### Authentication Flow
1. User authenticates → `auth.uid()` available
2. Policy checks user's role in `profiles` table
3. If vendor → joins to get assigned `vendor_id`
4. Filters data to match user's `vendor_id`
5. If admin → bypasses all filters

## 🧪 Testing Scenarios

### Test 1: Admin Access
```sql
-- As admin user
SELECT COUNT(*) FROM products;  -- Should return ALL products
SELECT COUNT(*) FROM sales;     -- Should return ALL sales
```

### Test 2: Vendor Access
```sql
-- As vendor user
SELECT COUNT(*) FROM products;  -- Should return ONLY their products
SELECT COUNT(*) FROM sales;     -- Should return ONLY their sales
```

### Test 3: Cross-Vendor Isolation
```sql
-- Verify no cross-vendor data leakage
SELECT * FROM products WHERE vendor_id != get_current_user_vendor_id();
-- Should return 0 rows for vendors
```

## 🚨 Troubleshooting

### If Issues Occur:
1. **Immediate rollback:** Run `rollback-vendor-rls.sql`
2. **Check policies:** Run `test-vendor-rls.sql` for diagnostics
3. **Verify profiles:** Ensure `profiles.vendor_id` is correctly set
4. **Test authentication:** Verify `auth.uid()` returns correct user ID

### Common Issues:
- **Missing vendor_id in profiles:** Policies won't work
- **Incorrect role assignment:** Users get wrong access level
- **Circular dependencies:** Avoid policies that reference each other

## 📋 Expected Results

### Before RLS:
- `SELECT * FROM sales` → Returns all sales (any user)
- Security handled only in application layer

### After RLS:
- `SELECT * FROM sales` → Returns only user's sales (vendor)
- `SELECT * FROM sales` → Returns all sales (admin)
- Security enforced at database level

## 🔄 Maintenance

### Regular Checks:
1. Monitor policy performance
2. Verify new tables have RLS enabled
3. Test with new user roles
4. Audit access logs for violations

### Updates:
- When adding new tables, create corresponding RLS policies
- When modifying user roles, update policy logic
- Keep helper functions in sync with schema changes

## 🎯 Success Criteria

✅ Vendors can only see their own data  
✅ Admins maintain full system access  
✅ Database-level security enforcement  
✅ No application-layer bypass possible  
✅ Performance impact is minimal  
✅ Easy to maintain and extend
