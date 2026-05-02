import express from 'express';
import {
  Brand,
  Category,
  Product,
  Unit,
  Stakeholder,
  Employee,
  Outlet,
  Warehouse,
} from '../../models/inventory/catalogModels.js';

import {
  list,
  getById,
  create,
  update,
  remove,
} from '../../controllers/inventory/crudController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();


// 🔒 Apply auth + role restriction to ALL routes
router.use(protectPOS);
router.use(catalogInventoryAccess);


const mountCrud = (path, model) => {
  router.route(path)
    .get(list(model))
    .post(create(model));

  router.route(`${path}/:id`)
    .get(getById(model))
    .put(update(model))
    .delete(remove(model));
};

mountCrud('/brands', Brand);
mountCrud('/categories', Category);
mountCrud('/products', Product);
mountCrud('/units', Unit);
mountCrud('/stakeholders', Stakeholder);
mountCrud('/employees', Employee);
mountCrud('/outlets', Outlet);
mountCrud('/warehouses', Warehouse);

export default router;