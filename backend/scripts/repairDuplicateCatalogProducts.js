import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '../.env' });

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
});

const dryRun = !process.argv.includes('--apply');

const duplicateGroupsSql = `
  WITH grouped AS (
    SELECT
      lower(regexp_replace(trim(product_name_eng), '\\s+', ' ', 'g')) AS product_key,
      MIN(id) AS canonical_product_id,
      array_agg(id ORDER BY id) AS product_ids,
      COUNT(*) AS product_count
    FROM catalog.products
    WHERE product_name_eng IS NOT NULL
      AND trim(product_name_eng) <> ''
    GROUP BY lower(regexp_replace(trim(product_name_eng), '\\s+', ' ', 'g'))
    HAVING COUNT(*) > 1
  )
  SELECT *
  FROM grouped
  ORDER BY canonical_product_id
`;

const main = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: groups } = await client.query(duplicateGroupsSql);
    const summary = [];

    for (const group of groups) {
      const duplicateProductIds = group.product_ids
        .map(Number)
        .filter((id) => id !== Number(group.canonical_product_id));

      if (!duplicateProductIds.length) continue;

      const { rows: barcodeRows } = await client.query(
        `
        WITH duplicate_barcodes AS (
          SELECT
            pb.*,
            FIRST_VALUE(pb.id) OVER (
              PARTITION BY pb.brand_id, pb.category_id, pb.unit_id, pb.quantity
              ORDER BY
                CASE WHEN pb.product_id = $1 THEN 0 ELSE 1 END,
                pb.id
            ) AS canonical_barcode_id
          FROM catalog.product_barcodes pb
          WHERE pb.product_id = ANY($2::bigint[])
        )
        SELECT *
        FROM duplicate_barcodes
        ORDER BY id
        `,
        [Number(group.canonical_product_id), group.product_ids.map(Number)]
      );

      for (const barcode of barcodeRows) {
        if (Number(barcode.id) === Number(barcode.canonical_barcode_id)) {
          await client.query(
            `
            UPDATE catalog.product_barcodes
            SET product_id = $1,
                is_active = true,
                updated_at = now()
            WHERE id = $2
            `,
            [Number(group.canonical_product_id), Number(barcode.id)]
          );
          continue;
        }

        await client.query(
          `
          UPDATE inventory.inventory_products
          SET product_barcode_id = $1,
              updated_at = now()
          WHERE product_barcode_id = $2
          `,
          [Number(barcode.canonical_barcode_id), Number(barcode.id)]
        );

        await client.query(
          `
          UPDATE dispatch.dispatch_order_items
          SET product_barcode_id = $1,
              product_id = $2
          WHERE product_barcode_id = $3
          `,
          [
            Number(barcode.canonical_barcode_id),
            Number(group.canonical_product_id),
            Number(barcode.id),
          ]
        );

        await client.query(
          `
          DELETE FROM catalog.product_barcodes
          WHERE id = $1
          `,
          [Number(barcode.id)]
        );
      }

      await client.query(
        `
        UPDATE purchases.purchase_order_items
        SET product_id = $1,
            updated_at = now()
        WHERE product_id = ANY($2::bigint[])
        `,
        [Number(group.canonical_product_id), duplicateProductIds]
      );

      await client.query(
        `
        UPDATE dispatch.dispatch_order_items
        SET product_id = $1
        WHERE product_id = ANY($2::bigint[])
        `,
        [Number(group.canonical_product_id), duplicateProductIds]
      );

      await client.query(
        `
        UPDATE inventory.inventory_products
        SET product_code = canonical.product_code,
            product_name = COALESCE(canonical.product_name_eng, canonical.product_name_tel, canonical.product_code),
            updated_at = now()
        FROM catalog.products canonical
        WHERE canonical.id = $1
          AND inventory.inventory_products.product_barcode_id IN (
            SELECT id
            FROM catalog.product_barcodes
            WHERE product_id = $1
          )
        `,
        [Number(group.canonical_product_id)]
      );

      await client.query(
        `
        DELETE FROM catalog.products
        WHERE id = ANY($1::bigint[])
        `,
        [duplicateProductIds]
      );

      summary.push({
        product_key: group.product_key,
        canonical_product_id: Number(group.canonical_product_id),
        removed_product_ids: duplicateProductIds,
        affected_barcodes: barcodeRows.map((row) => Number(row.id)),
      });
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    console.log(
      JSON.stringify(
        {
          mode: dryRun ? 'dry-run' : 'applied',
          duplicate_groups: summary.length,
          summary,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

main();
