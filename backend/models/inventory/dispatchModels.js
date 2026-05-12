import { query, getClient } from '../../config/pg.js';

const toPgDate = (value) => {
  if (!value) return null;
  const match = String(value).trim().match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
};

export const DispatchOrder = {
  async findAll(limit = 100, offset = 0) {
    const { rows } = await query(
      `
      SELECT 
        d.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', i.id,
              'dispatch_order_id', i.dispatch_order_id,
              'product_barcode_id', i.product_barcode_id,
              'mk_barcode', pb.mk_barcode,
              'barcode', pb.barcode,
              'barcode_quantity', pb.quantity,
              'product_id', i.product_id,
              'brand_id', i.brand_id,
              'category_id', i.category_id,
              'unit_id', i.unit_id,
              'qty', i.qty,
              'no_of_units', i.no_of_units,
              'exp_date', to_char(i.exp_date::date, 'YYYY-MM-DD'),
              'notes', i.notes,
              'product_code', p.product_code,
              'product_name_eng', p.product_name_eng,
              'product_name_tel', p.product_name_tel,
              'brand_code', b.brand_code,
              'brand_name_english', b.brand_name_english,
              'brand_name_telugu', b.brand_name_telugu,
              'category_code', c.category_code,
              'category_name_english', c.category_name_english,
              'category_name_telugu', c.category_name_telugu,
              'unit_code', u.unit_code,
              'unit_name', u.unit_name,
              'unit_short_code', u.unit_short_code
            )
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS items
      FROM dispatch.dispatch_order d
      LEFT JOIN dispatch.dispatch_order_items i ON i.dispatch_order_id = d.id
      LEFT JOIN catalog.product_barcodes pb ON pb.id = i.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = i.product_id
      LEFT JOIN catalog.brands b ON b.id = i.brand_id
      LEFT JOIN catalog.categories c ON c.id = i.category_id
      LEFT JOIN catalog.units u ON u.id = i.unit_id
      GROUP BY d.id
      ORDER BY d.id DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return rows;
  },

  async findById(id) {
    const { rows } = await query(
      `
      SELECT 
        d.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', i.id,
              'dispatch_order_id', i.dispatch_order_id,
              'product_barcode_id', i.product_barcode_id,
              'mk_barcode', pb.mk_barcode,
              'barcode', pb.barcode,
              'barcode_quantity', pb.quantity,
              'product_id', i.product_id,
              'brand_id', i.brand_id,
              'category_id', i.category_id,
              'unit_id', i.unit_id,
              'qty', i.qty,
              'no_of_units', i.no_of_units,
              'exp_date', to_char(i.exp_date::date, 'YYYY-MM-DD'),
              'notes', i.notes,
              'product_code', p.product_code,
              'product_name_eng', p.product_name_eng,
              'product_name_tel', p.product_name_tel,
              'brand_code', b.brand_code,
              'brand_name_english', b.brand_name_english,
              'brand_name_telugu', b.brand_name_telugu,
              'category_code', c.category_code,
              'category_name_english', c.category_name_english,
              'category_name_telugu', c.category_name_telugu,
              'unit_code', u.unit_code,
              'unit_name', u.unit_name,
              'unit_short_code', u.unit_short_code
            )
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'
        ) AS items
      FROM dispatch.dispatch_order d
      LEFT JOIN dispatch.dispatch_order_items i ON i.dispatch_order_id = d.id
      LEFT JOIN catalog.product_barcodes pb ON pb.id = i.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = i.product_id
      LEFT JOIN catalog.brands b ON b.id = i.brand_id
      LEFT JOIN catalog.categories c ON c.id = i.category_id
      LEFT JOIN catalog.units u ON u.id = i.unit_id
      WHERE d.id = $1
      GROUP BY d.id
      `,
      [Number(id)]
    );

    return rows[0];
  },

  async createWithItems(data) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const {
        purchase_order_id = null,
        dispatch_no,
        dispatch_status = 'draft',
        dispatch_notes = null,
        source = null,
        destination = null,
        expected_dispatch_at = null,
        items = [],
      } = data;

      const orderResult = await client.query(
        `
        INSERT INTO dispatch.dispatch_order (
          purchase_order_id,
          dispatch_no,
          dispatch_status,
          dispatch_notes,
          source,
          destination,
          expected_dispatch_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          purchase_order_id,
          dispatch_no,
          dispatch_status,
          dispatch_notes,
          source,
          destination,
          expected_dispatch_at,
        ]
      );

      const order = orderResult.rows[0];

      for (const item of items) {
        const expDate = toPgDate(item.exp_date);

        if (!expDate) {
          throw new Error(
            `Expiry date missing for barcode ID ${item.product_barcode_id}`
          );
        }

        await client.query(
          `
          INSERT INTO dispatch.dispatch_order_items (
            dispatch_order_id,
            product_id,
            brand_id,
            category_id,
            unit_id,
            qty,
            notes,
            product_barcode_id,
            exp_date,
            no_of_units
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            Number(order.id),
            Number(item.product_id),
            item.brand_id ? Number(item.brand_id) : null,
            item.category_id ? Number(item.category_id) : null,
            item.unit_id ? Number(item.unit_id) : null,
            Number(item.qty || item.no_of_units),
            item.notes || null,
            item.product_barcode_id ? Number(item.product_barcode_id) : null,
            expDate,
            Number(item.no_of_units || item.qty),
          ]
        );
      }

      await client.query('COMMIT');
      return await this.findById(order.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async update(id, data) {
    const {
      purchase_order_id,
      dispatch_no,
      dispatch_status,
      dispatch_notes,
      source,
      destination,
      expected_dispatch_at,
    } = data;

    const { rows } = await query(
      `
      UPDATE dispatch.dispatch_order
      SET
        purchase_order_id = COALESCE($1, purchase_order_id),
        dispatch_no = COALESCE($2, dispatch_no),
        dispatch_status = COALESCE($3, dispatch_status),
        dispatch_notes = COALESCE($4, dispatch_notes),
        source = COALESCE($5, source),
        destination = COALESCE($6, destination),
        expected_dispatch_at = COALESCE($7, expected_dispatch_at),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
      `,
      [
        purchase_order_id ?? null,
        dispatch_no ?? null,
        dispatch_status ?? null,
        dispatch_notes ?? null,
        source ?? null,
        destination ?? null,
        expected_dispatch_at ?? null,
        Number(id),
      ]
    );

    return rows[0];
  },

  async replaceItems(dispatchOrderId, items = []) {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      await client.query(
        `
        DELETE FROM dispatch.dispatch_order_items
        WHERE dispatch_order_id = $1
        `,
        [Number(dispatchOrderId)]
      );

      for (const item of items) {
        const expDate = toPgDate(item.exp_date);

        if (!expDate) {
          throw new Error(
            `Expiry date missing for barcode ID ${item.product_barcode_id}`
          );
        }

        await client.query(
          `
          INSERT INTO dispatch.dispatch_order_items (
            dispatch_order_id,
            product_id,
            brand_id,
            category_id,
            unit_id,
            qty,
            notes,
            product_barcode_id,
            exp_date,
            no_of_units
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          `,
          [
            Number(dispatchOrderId),
            Number(item.product_id),
            item.brand_id ? Number(item.brand_id) : null,
            item.category_id ? Number(item.category_id) : null,
            item.unit_id ? Number(item.unit_id) : null,
            Number(item.qty || item.no_of_units),
            item.notes || null,
            item.product_barcode_id ? Number(item.product_barcode_id) : null,
            expDate,
            Number(item.no_of_units || item.qty),
          ]
        );
      }

      await client.query('COMMIT');
      return await this.findById(dispatchOrderId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async remove(id) {
    const { rows } = await query(
      `
      DELETE FROM dispatch.dispatch_order
      WHERE id = $1
      RETURNING *
      `,
      [Number(id)]
    );

    return rows[0];
  },
};