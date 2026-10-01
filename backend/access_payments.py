"""One verified native-ETH payment grants permanent, wallet-bound game access."""
import uuid
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
from chain_config import CHAIN_ID
from market_payments import TREASURY, create_quote, reserve_transaction_hash, verify_transaction


async def ensure_access_indexes(db):
    await db.access_entitlements.create_index('account_id', unique=True)
    await db.purchase_orders.create_index('access_wallet', unique=True,
        partialFilterExpression={'access_wallet': {'$type': 'string'}})


async def has_paid_access(db, account_id):
    return bool(await db.access_entitlements.find_one(
        {'account_id': account_id.lower(), 'paid': True, 'chain_id': CHAIN_ID}, {'_id': 0, 'account_id': 1}))


async def _complete_access(db, order):
    if order.get('kind') != 'access' or order.get('payment_verified') is not True or not order.get('tx_hash'):
        raise PermissionError('verified_payment_required')
    now = datetime.now(timezone.utc).isoformat()
    # Durable verified order -> idempotent entitlement -> fulfilled marker.
    # Retrying after a crash between writes completes, but never bills twice.
    await db.access_entitlements.update_one({'account_id': order['account_id']}, {'$setOnInsert': {
        'account_id': order['account_id'], 'paid': True, 'chain_id': CHAIN_ID,
        'source_order_id': order['order_id'], 'tx_hash': order['tx_hash'],
        'quote': order.get('verified_quote') or order['quote'], 'confirmed_at': now,
    }}, upsert=True)
    await db.purchase_orders.update_one({'order_id': order['order_id'], 'payment_verified': True},
        {'$set': {'status': 'fulfilled', 'fulfilled_at': now}})


async def access_status(db, account_id):
    owner = account_id.lower()
    order = await db.purchase_orders.find_one({'access_wallet': owner, 'kind': 'access'}, {'_id': 0})
    if order and order.get('status') == 'delivering' and order.get('payment_verified') is True:
        await _complete_access(db, order)
        order = await db.purchase_orders.find_one({'order_id': order['order_id']}, {'_id': 0})
    return {'paid': await has_paid_access(db, owner), 'price_usd': '1.00', 'chain_id': CHAIN_ID,
            'treasury': TREASURY, 'order': order}


async def quote_access(db, account_id):
    owner = account_id.lower()
    state = await access_status(db, owner)
    if state['paid']:
        return state
    order = state['order']
    if not order:
        order = {'order_id': str(uuid.uuid4()), 'account_id': owner, 'access_wallet': owner,
                 'authenticated_wallet': owner, 'kind': 'access', 'sku': 'game_access',
                 'sku_name': 'Permanent game access', 'cents': 100, 'usd_str': '$1',
                 'status': 'created', 'request_id': str(uuid.uuid4()),
                 'created_at': datetime.now(timezone.utc).isoformat()}
        try:
            await db.purchase_orders.insert_one(dict(order))
        except DuplicateKeyError:
            order = await db.purchase_orders.find_one({'access_wallet': owner}, {'_id': 0})
    if not order.get('tx_hash'):
        await create_quote(db, order)
    return await access_status(db, owner)


async def submit_access(db, account_id, order_id, tx_hash):
    owner = account_id.lower()
    order = await db.purchase_orders.find_one(
        {'order_id': order_id, 'account_id': owner, 'kind': 'access'}, {'_id': 0})
    if not order:
        raise ValueError('access_order_not_found')
    order = await reserve_transaction_hash(db, order, tx_hash, owner)
    if order.get('status') == 'fulfilled':
        return await access_status(db, owner)
    if order.get('status') == 'delivering' and order.get('payment_verified') is True:
        await _complete_access(db, order)
        return await access_status(db, owner)
    try:
        verification = await verify_transaction(db, order, tx_hash, owner)
    except ValueError as error:
        # A reverted on-chain payment spent no value. Retain its audit record;
        # a future quote may create a new attempt. Pending/unknown never unlocks.
        if str(error) == 'payment_failed':
            await db.purchase_orders.update_one({'order_id': order_id, 'tx_hash': tx_hash.lower()},
                {'$set': {'status': 'payment_failed'}, '$unset': {'access_wallet': ''}})
        raise
    if verification.get('verified') is not True:
        await db.purchase_orders.update_one(
            {'order_id': order_id, 'status': {'$in': ['submitted', 'confirming']}},
            {'$set': {'status': verification['status'], 'payment_confirmations': verification.get('confirmations', 0)}})
        return await access_status(db, owner)
    verified_quote = next(q for q in [order['quote'], *(order.get('quote_history') or [])]
                          if q['quote_id'] == verification['quote_id'])
    await db.purchase_orders.update_one(
        {'order_id': order_id, 'tx_hash': tx_hash.lower(), 'status': {'$in': ['submitted', 'confirming']}},
        {'$set': {'status': 'delivering', 'payment_verified': True, 'verified_quote': verified_quote,
                  'payment_confirmations': verification['confirmations'],
                  'payment_verified_at': datetime.now(timezone.utc).isoformat()}})
    fresh = await db.purchase_orders.find_one({'order_id': order_id}, {'_id': 0})
    await _complete_access(db, fresh)
    return await access_status(db, owner)