require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const serviceMap = {
  "Drone Sales": {
    dbServiceName: "Sales",
    ticketType: "purchase"
  },
  "Drone Rental": {
    dbServiceName: "Rentals",
    ticketType: "rental"
  },
  "Repair Service": {
    dbServiceName: "Repair",
    ticketType: "repair"
  },
  "Replacement Parts": {
    dbServiceName: "Replacement Parts",
    ticketType: "service_request"
  },
  "Light Show Event": {
    dbServiceName: "Light Show",
    ticketType: "service_request"
  },
  "Training": {
    dbServiceName: "Other",
    ticketType: "service_request"
  },
  "Other": {
    dbServiceName: "Other",
    ticketType: "service_request"
  }
};

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

app.post("/api/tickets", async (req, res) => {
  let connection;

  try {
    const fullName = clean(req.body.name);
    const email = clean(req.body.email).toLowerCase();
    const phone = clean(req.body.phone);
    const selectedService = clean(req.body.service);
    const message = clean(req.body.message);

    if (!fullName || !email || !phone || !selectedService || !message) {
      return res.status(400).json({
        ok: false,
        message: "All fields are required."
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        ok: false,
        message: "Please enter a valid email address."
      });
    }

    const mapped = serviceMap[selectedService];
    if (!mapped) {
      return res.status(400).json({
        ok: false,
        message: "Invalid service selected."
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingCustomers] = await connection.execute(
      `SELECT customer_id
       FROM customers
       WHERE email = ?`,
      [email]
    );

    let customerId;

    if (existingCustomers.length > 0) {
      customerId = existingCustomers[0].customer_id;

      await connection.execute(
        `UPDATE customers
         SET full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
         WHERE customer_id = ?`,
        [fullName, phone, customerId]
      );
    } else {
      const [customerInsert] = await connection.execute(
        `INSERT INTO customers (full_name, email, phone)
         VALUES (?, ?, ?)`,
        [fullName, email, phone]
      );

      customerId = customerInsert.insertId;
    }

    const [services] = await connection.execute(
      `SELECT service_id
       FROM services
       WHERE service_name = ?
         AND is_active = 1
       LIMIT 1`,
      [mapped.dbServiceName]
    );

    if (services.length === 0) {
      throw new Error(`Active service not found: ${mapped.dbServiceName}`);
    }

    const serviceId = services[0].service_id;

    const [ticketInsert] = await connection.execute(
      `INSERT INTO tickets (customer_id, service_id, ticket_type, status, message)
       VALUES (?, ?, ?, 'new', ?)`,
      [customerId, serviceId, mapped.ticketType, message]
    );

    await connection.commit();

    return res.status(201).json({
      ok: true,
      message: "Your request has been received.",
      ticket_id: ticketInsert.insertId
    });
  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {}
    }

    console.error("Ticket submission failed:", err);

    return res.status(500).json({
      ok: false,
      message: "We could not submit your request right now."
    });
  } finally {
    if (connection) connection.release();
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows[0].ok === 1 });
  } catch (err) {
    res.status(500).json({ ok: false, db: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});