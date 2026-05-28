import BasePgModel from '../inventory/BasePgModel.js';
import { query } from '../../config/pg.js';

const AD_COLUMNS = [
  'id',
  'outlet_id',
  'name',
  'type',
  'template',
  'sale_type',
  'priority',
  'sequence',
  'timer_seconds',
  'start_date',
  'end_date',
  'status',
  'generated_video_path',
  'config',
  'created_by',
  'updated_by',
];

const DETAIL_COLUMNS = [
  'id',
  'outlet_advertise_id',
  'repository_id',
  'product_id',
  'product_name',
  'brand_name',
  'title',
  'description',
  'media_type',
  'media_path',
  'target_area',
  'sequence',
  'duration_seconds',
  'metadata',
];

class RepositoryModel extends BasePgModel {
  constructor() {
    super('catalog.repository', [
      'id',
      'name',
      'type',
      'for_scope',
      'connect_string',
      'description',
      'is_active',
    ]);
  }
}

class OutletAdvertiseModel extends BasePgModel {
  constructor() {
    super('marketing.outlet_advertise', AD_COLUMNS);
  }

  async findAllWithDetails({ limit, offset = 0 } = {}) {
    let sql = `
      SELECT
        oa.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oad.id,
              'outlet_advertise_id', oad.outlet_advertise_id,
              'repository_id', oad.repository_id,
              'repository_name', r.name,
              'repository_type', r.type,
              'product_id', oad.product_id,
              'product_name', oad.product_name,
              'brand_name', oad.brand_name,
              'title', oad.title,
              'description', oad.description,
              'media_type', oad.media_type,
              'media_path', oad.media_path,
              'target_area', oad.target_area,
              'sequence', oad.sequence,
              'duration_seconds', oad.duration_seconds,
              'metadata', oad.metadata
            )
            ORDER BY oad.sequence ASC, oad.id ASC
          ) FILTER (WHERE oad.id IS NOT NULL),
          '[]'
        ) AS details
      FROM marketing.outlet_advertise oa
      LEFT JOIN marketing.outlet_advertise_details oad
        ON oad.outlet_advertise_id = oa.id
      LEFT JOIN catalog.repository r
        ON r.id = oad.repository_id
      GROUP BY oa.id
      ORDER BY oa.priority DESC, oa.sequence ASC, oa.id DESC
    `;

    const params = [];
    if (limit && Number(limit) > 0) {
      sql += ' LIMIT $1 OFFSET $2';
      params.push(Number(limit), Number(offset));
    }

    const { rows } = await query(sql, params);
    return rows;
  }

  async findByIdWithDetails(id) {
    const rows = await this.findAllWithDetails();
    return rows.find((row) => String(row.id) === String(id)) || null;
  }

  async findActiveFeed({ outletId } = {}) {
    const params = [];
    let outletFilter = '';

    if (outletId) {
      params.push(outletId);
      outletFilter = `AND (oa.outlet_id = $${params.length} OR oa.outlet_id IS NULL)`;
    }

    const { rows } = await query(
      `
      SELECT
        oa.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oad.id,
              'repository_id', oad.repository_id,
              'product_id', oad.product_id,
              'product_name', oad.product_name,
              'brand_name', oad.brand_name,
              'title', oad.title,
              'description', oad.description,
              'media_type', oad.media_type,
              'media_path', oad.media_path,
              'target_area', oad.target_area,
              'sequence', oad.sequence,
              'duration_seconds', oad.duration_seconds,
              'metadata', oad.metadata
            )
            ORDER BY oad.sequence ASC, oad.id ASC
          ) FILTER (WHERE oad.id IS NOT NULL),
          '[]'
        ) AS details
      FROM marketing.outlet_advertise oa
      LEFT JOIN marketing.outlet_advertise_details oad
        ON oad.outlet_advertise_id = oa.id
      WHERE oa.status = 'active'
        AND (oa.start_date IS NULL OR oa.start_date <= CURRENT_DATE)
        AND (oa.end_date IS NULL OR oa.end_date >= CURRENT_DATE)
        ${outletFilter}
      GROUP BY oa.id
      ORDER BY oa.priority DESC, oa.sequence ASC, oa.id DESC
      `,
      params
    );

    return rows;
  }
}

class OutletAdvertiseDetailModel extends BasePgModel {
  constructor() {
    super('marketing.outlet_advertise_details', DETAIL_COLUMNS);
  }
}

export const Repository = new RepositoryModel();
export const OutletAdvertise = new OutletAdvertiseModel();
export const OutletAdvertiseDetail = new OutletAdvertiseDetailModel();
