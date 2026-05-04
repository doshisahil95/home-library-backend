const { ObjectId } = require("mongodb");
const { getUsers, getBooks, getGenres, getHouses, getLanguages } = require("../db.js");
const validate = require("../utils/validate.js");


/* ═══════════════════════ LIST USERS ════════════════════════════════════════ */

exports.listUsers = async (req, res) => {
    try {
        const users = getUsers();
        const list = await users
            .find({}, {
                projection: {
                    password: 0,
                    resetOTP: 0,
                    otpExpiry: 0,
                    otpAttempts: 0,
                    loginAttempts: 0,
                    lockUntil: 0,
                },
            })
            .sort({ createdAt: 1 })
            .toArray();

        res.json({ data: list });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch users",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ ADD USER ══════════════════════════════════════════ */

exports.addUser = async (req, res) => {
    try {
        const { name, email, role } = req.body;

        const nv = validate.validateName({ name });
        if (!nv.valid) return res.status(400).json({ message: nv.message });

        const ev = validate.validateEmail({ email });
        if (!ev.valid) return res.status(400).json({ message: ev.message });

        const rv = validate.validateRole({ role });
        if (!rv.valid) return res.status(400).json({ message: rv.message });

        const users = getUsers();

        const existing = await users.findOne({ email: email.toLowerCase().trim() });
        if (existing) {
            return res.status(400).json({ message: "A user with this email already exists" });
        }

        const now = new Date();
        const result = await users.insertOne({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: null,
            firstLogin: true,
            role,
            theme: "light",
            loginAttempts: 0,
            createdAt: now,
            updatedAt: now,
        });

        const created = await users.findOne(
            { _id: result.insertedId },
            { projection: { password: 0, resetOTP: 0, otpExpiry: 0, otpAttempts: 0, loginAttempts: 0, lockUntil: 0 } }
        );

        res.status(201).json({ data: created });

    } catch (error) {
        res.status(500).json({
            message: "Failed to add user",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ CHANGE ROLE ═══════════════════════════════════════ */

exports.changeRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const rv = validate.validateRole({ role });
        if (!rv.valid) return res.status(400).json({ message: rv.message });

        if (req.user.id.toString() === id) {
            return res.status(403).json({ message: "You cannot change your own role" });
        }

        const users = getUsers();

        const target = await users.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).json({ message: "User not found" });

        if (target.role === "superadmin") {
            return res.status(403).json({ message: "The super admin's role cannot be changed" });
        }

        const result = await users.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { role, updatedAt: new Date() } },
            {
                returnDocument: "after",
                projection: { password: 0, resetOTP: 0, otpExpiry: 0, otpAttempts: 0, loginAttempts: 0, lockUntil: 0 },
            }
        );

        if (!result) return res.status(404).json({ message: "User not found" });

        res.json({ data: result });

    } catch (error) {
        res.status(500).json({
            message: "Failed to change role",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ DELETE USER ═══════════════════════════════════════ */

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        if (req.user.id.toString() === id) {
            return res.status(403).json({ message: "You cannot delete your own account" });
        }

        const users = getUsers();
        const target = await users.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).json({ message: "User not found" });

        if (target.role === "superadmin") {
            return res.status(403).json({ message: "The super admin account cannot be deleted" });
        }

        const userId = new ObjectId(id);
        const books = getBooks();

        await books.updateMany(
            {},
            { $pull: { statuses: { userId }, publicByUsers: userId } }
        );

        await users.deleteOne({ _id: userId });

        res.json({ message: "User deleted successfully" });

    } catch (error) {
        res.status(500).json({
            message: "Failed to delete user",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ APPROVE PASSWORD RESET ════════════════════════════ */

exports.approvePasswordReset = async (req, res) => {
    try {
        const { id } = req.params;

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        if (req.user.id.toString() === id) {
            return res.status(403).json({ message: "Use the forgot password flow to reset your own password" });
        }

        const users = getUsers();
        const target = await users.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).json({ message: "User not found" });

        if (target.role === "superadmin") {
            return res.status(403).json({ message: "Super admin uses the standard OTP flow" });
        }

        if (target.passwordResetApproved) {
            return res.status(400).json({ message: "A reset is already approved for this user" });
        }

        await users.updateOne(
            { _id: new ObjectId(id) },
            { $set: { passwordResetApproved: true, updatedAt: new Date() } }
        );

        res.json({ message: "Password reset approved" });

    } catch (error) {
        res.status(500).json({
            message: "Failed to approve reset",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ REVOKE PASSWORD RESET ═════════════════════════════ */

exports.revokePasswordReset = async (req, res) => {
    try {
        const { id } = req.params;

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const users = getUsers();
        const target = await users.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).json({ message: "User not found" });

        if (!target.passwordResetApproved) {
            return res.status(400).json({ message: "No pending reset approval for this user" });
        }

        await users.updateOne(
            { _id: new ObjectId(id) },
            { $set: { passwordResetApproved: false, updatedAt: new Date() } }
        );

        res.json({ message: "Password reset approval revoked" });

    } catch (error) {
        res.status(500).json({
            message: "Failed to revoke reset",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ CSV PARSING ═══════════════════════════════════════ */
// Hand-rolled parser — handles quoted fields (including quoted commas).
// Genre column uses semicolon as multi-value separator.

function parseCSV(text) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines.length < 2) return { headers: [], rows: [] };

    const parseRow = (line) => {
        const fields = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"' && !inQuotes) { inQuotes = true; continue; }
            if (ch === '"' && inQuotes) {
                if (line[i + 1] === '"') { current += '"'; i++; }
                else inQuotes = false;
                continue;
            }
            if (ch === "," && !inQuotes) { fields.push(current.trim()); current = ""; continue; }
            current += ch;
        }
        fields.push(current.trim());
        return fields;
    };

    const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseRow(line);
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
        rows.push({ rowNumber: i + 1, data: row });
    }

    return { headers, rows };
}

function normaliseRow(raw) {
    const makePublicRaw = (raw.makepublic || raw.makePublic || "").trim().toLowerCase();
    return {
        title: (raw.title || "").trim(),
        author: (raw.author || "").trim(),
        house: (raw.house || "").trim(),
        genres: (raw.genre || "").split(";").map((g) => g.trim()).filter(Boolean),
        language: (raw.language || "").trim(),
        locationInHouse: (raw.locationinhouse || "").trim(),
        description: (raw.description || "").trim(),
        makePublic: makePublicRaw === "true" || makePublicRaw === "1" || makePublicRaw === "yes",
    };
}


/* ═══════════════════════ VALIDATE BOOK CSV ═════════════════════════════════ */

exports.validateCSV = async (req, res) => {
    try {
        const csvText = req.body.csv;
        if (!csvText || typeof csvText !== "string") {
            return res.status(400).json({ message: "CSV content is required" });
        }

        const { headers, rows } = parseCSV(csvText);

        const requiredHeaders = ["title", "author", "house", "genre"];
        const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
        if (missingHeaders.length > 0) {
            return res.status(400).json({ message: `CSV is missing required columns: ${missingHeaders.join(", ")}` });
        }

        if (rows.length === 0) return res.status(400).json({ message: "CSV has no data rows" });
        if (rows.length > 500) return res.status(400).json({ message: "CSV cannot exceed 500 rows per upload" });

        const [genreDocs, houseDocs, languageDocs] = await Promise.all([
            getGenres().find({}).toArray(),
            getHouses().find({}).toArray(),
            getLanguages().find({}).toArray(),
        ]);

        const validGenres = new Set(genreDocs.map((g) => g.name.toLowerCase()));
        const validHouses = new Set(houseDocs.map((h) => h.name.toLowerCase()));
        const validLanguages = new Set(languageDocs.map((l) => l.name.toLowerCase()));
        const seenInFile = new Map();
        const errors = [];
        const validRows = [];

        for (const { rowNumber, data } of rows) {
            const norm = normaliseRow(data);
            const rowErrors = [];

            const fv = validate.validateCSVRow(norm);
            if (!fv.valid) { rowErrors.push(fv.message); }

            if (rowErrors.length === 0) {
                if (!validHouses.has(norm.house.toLowerCase())) {
                    rowErrors.push(`House "${norm.house}" does not exist`);
                }
                const invalidGenres = norm.genres.filter((g) => !validGenres.has(g.toLowerCase()));
                if (invalidGenres.length > 0) {
                    rowErrors.push(`Unknown genre${invalidGenres.length > 1 ? "s" : ""}: ${invalidGenres.join(", ")}`);
                }
                if (norm.language && !validLanguages.has(norm.language.toLowerCase())) {
                    rowErrors.push(`Language "${norm.language}" does not exist`);
                }

                const key = `${norm.title.toLowerCase()}::${norm.author.toLowerCase()}`;
                if (seenInFile.has(key)) {
                    rowErrors.push(`Duplicate of row ${seenInFile.get(key)} in this file`);
                } else {
                    seenInFile.set(key, rowNumber);
                }

                if (rowErrors.length === 0) {
                    const books = getBooks();
                    const existing = await books.findOne(
                        {
                            title: { $regex: `^${escapeRegex(norm.title)}$`, $options: "i" },
                            author: { $regex: `^${escapeRegex(norm.author)}$`, $options: "i" },
                        },
                        { projection: { _id: 1 } }
                    );
                    if (existing) {
                        rowErrors.push(`"${norm.title}" by ${norm.author} already exists in the library`);
                    }
                }
            }

            if (rowErrors.length > 0) {
                errors.push({ row: rowNumber, title: norm.title || "(no title)", reasons: rowErrors });
            } else {
                validRows.push(norm);
            }
        }

        res.json({ validCount: validRows.length, errorCount: errors.length, errors });

    } catch (error) {
        res.status(500).json({
            message: "Validation failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ IMPORT BOOK CSV ═══════════════════════════════════ */

exports.importCSV = async (req, res) => {
    try {
        const { csvText, stopOnError = false } = req.body;

        if (!csvText || typeof csvText !== "string") {
            return res.status(400).json({ message: "CSV content is required" });
        }

        const { headers, rows } = parseCSV(csvText);
        const requiredHeaders = ["title", "author", "house", "genre"];
        const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
        if (missingHeaders.length > 0) {
            return res.status(400).json({ message: `CSV is missing required columns: ${missingHeaders.join(", ")}` });
        }

        if (rows.length === 0) return res.status(400).json({ message: "CSV has no data rows" });
        if (rows.length > 500) return res.status(400).json({ message: "CSV cannot exceed 500 rows per upload" });

        const [genreDocs, houseDocs, languageDocs] = await Promise.all([
            getGenres().find({}).toArray(),
            getHouses().find({}).toArray(),
            getLanguages().find({}).toArray(),
        ]);

        const validGenres = new Set(genreDocs.map((g) => g.name.toLowerCase()));
        const validHouses = new Set(houseDocs.map((h) => h.name.toLowerCase()));
        const validLanguages = new Set(languageDocs.map((l) => l.name.toLowerCase()));
        const seenInFile = new Map();

        const books = getBooks();
        const errors = [];
        let added = 0;
        let stoppedEarly = false;
        const now = new Date();
        const importingUserId = new ObjectId(req.user.id);

        for (const { rowNumber, data } of rows) {
            const norm = normaliseRow(data);
            const rowErrors = [];

            const fv = validate.validateCSVRow(norm);
            if (!fv.valid) rowErrors.push(fv.message);

            if (rowErrors.length === 0) {
                if (!validHouses.has(norm.house.toLowerCase())) rowErrors.push(`House "${norm.house}" does not exist`);
                const invalidGenres = norm.genres.filter((g) => !validGenres.has(g.toLowerCase()));
                if (invalidGenres.length > 0) rowErrors.push(`Unknown genres: ${invalidGenres.join(", ")}`);
                if (norm.language && !validLanguages.has(norm.language.toLowerCase())) rowErrors.push(`Language "${norm.language}" does not exist`);

                const key = `${norm.title.toLowerCase()}::${norm.author.toLowerCase()}`;
                if (seenInFile.has(key)) {
                    rowErrors.push(`Duplicate of row ${seenInFile.get(key)} in this file`);
                } else {
                    seenInFile.set(key, rowNumber);
                }

                if (rowErrors.length === 0) {
                    const existing = await books.findOne(
                        {
                            title: { $regex: `^${escapeRegex(norm.title)}$`, $options: "i" },
                            author: { $regex: `^${escapeRegex(norm.author)}$`, $options: "i" },
                        },
                        { projection: { _id: 1 } }
                    );
                    if (existing) rowErrors.push(`"${norm.title}" by ${norm.author} already exists`);
                }
            }

            if (rowErrors.length > 0) {
                errors.push({ row: rowNumber, title: norm.title || "(no title)", reasons: rowErrors });
                if (stopOnError) { stoppedEarly = true; break; }
                continue;
            }

            const canonicalHouse = houseDocs.find((h) => h.name.toLowerCase() === norm.house.toLowerCase())?.name || norm.house;
            const canonicalGenres = norm.genres.map((g) => genreDocs.find((d) => d.name.toLowerCase() === g.toLowerCase())?.name || g);
            const canonicalLanguage = norm.language
                ? (languageDocs.find((l) => l.name.toLowerCase() === norm.language.toLowerCase())?.name || norm.language)
                : "";

            try {
                await books.insertOne({
                    title: norm.title,
                    author: norm.author,
                    house: canonicalHouse,
                    genre: canonicalGenres,
                    language: canonicalLanguage,
                    locationInHouse: norm.locationInHouse,
                    description: norm.description,
                    statuses: [],
                    publicByUsers: norm.makePublic ? [importingUserId] : [],
                    createdAt: now,
                    updatedAt: now,
                });
                added++;
            } catch (insertErr) {
                const reason = insertErr.code === 11000
                    ? `"${norm.title}" by ${norm.author} already exists`
                    : "Insert failed unexpectedly";
                errors.push({ row: rowNumber, title: norm.title, reasons: [reason] });
                if (stopOnError) { stoppedEarly = true; break; }
            }
        }

        res.json({ added, errorCount: errors.length, errors, stoppedEarly });

    } catch (error) {
        res.status(500).json({
            message: "Import failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ VALIDATE REFERENCE DATA CSV ═══════════════════════ */
// Single-column CSV (header: "name") for genres, languages, or houses.
// Existing DB entries are silently skipped (not treated as errors).

exports.validateRefCSV = async (req, res) => {
    try {
        const { type, csv } = req.body;

        if (!["genres", "languages", "houses"].includes(type)) {
            return res.status(400).json({ message: "Invalid reference data type" });
        }
        if (!csv || typeof csv !== "string") {
            return res.status(400).json({ message: "CSV content is required" });
        }

        const { headers, rows } = parseCSV(csv);

        if (!headers.includes("name")) {
            return res.status(400).json({ message: 'CSV must have a "name" column header' });
        }
        if (rows.length === 0) {
            return res.status(400).json({ message: "CSV has no data rows" });
        }
        if (rows.length > 200) {
            return res.status(400).json({ message: "CSV cannot exceed 200 rows per upload" });
        }

        const collection = type === "genres" ? getGenres() : type === "houses" ? getHouses() : getLanguages();
        const existing = await collection.find({}, { projection: { name: 1 } }).toArray();
        const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));

        const seenInFile = new Set();
        const errors = [];
        const validNames = [];
        const skipped = [];

        for (const { rowNumber, data } of rows) {
            const name = (data.name || "").trim();

            if (!name) {
                errors.push({ row: rowNumber, name: "(empty)", reason: "Name is required" });
                continue;
            }
            if (name.length > 100) {
                errors.push({ row: rowNumber, name, reason: "Name must be 100 characters or fewer" });
                continue;
            }

            const nameLower = name.toLowerCase();

            if (seenInFile.has(nameLower)) {
                errors.push({ row: rowNumber, name, reason: "Duplicate within this file" });
                continue;
            }
            seenInFile.add(nameLower);

            // Already in DB — skip silently, not an error
            if (existingNames.has(nameLower)) {
                skipped.push(name);
                continue;
            }

            validNames.push(name);
        }

        res.json({
            validCount: validNames.length,
            skippedCount: skipped.length,
            skipped,
            errorCount: errors.length,
            errors,
        });

    } catch (error) {
        res.status(500).json({
            message: "Validation failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ IMPORT REFERENCE DATA CSV ════════════════════════ */

exports.importRefCSV = async (req, res) => {
    try {
        const { type, csv } = req.body;

        if (!["genres", "languages", "houses"].includes(type)) {
            return res.status(400).json({ message: "Invalid reference data type" });
        }
        if (!csv || typeof csv !== "string") {
            return res.status(400).json({ message: "CSV content is required" });
        }

        const { headers, rows } = parseCSV(csv);

        if (!headers.includes("name")) {
            return res.status(400).json({ message: 'CSV must have a "name" column header' });
        }
        if (rows.length === 0) return res.status(400).json({ message: "CSV has no data rows" });
        if (rows.length > 200) return res.status(400).json({ message: "CSV cannot exceed 200 rows" });

        const collection = type === "genres" ? getGenres() : type === "houses" ? getHouses() : getLanguages();
        const existing = await collection.find({}, { projection: { name: 1 } }).toArray();
        const existingNames = new Set(existing.map((e) => e.name.toLowerCase()));

        const seenInFile = new Set();
        const now = new Date();
        let added = 0;
        let skipped = 0;
        const errors = [];

        for (const { rowNumber, data } of rows) {
            const rawName = (data.name || "").trim();

            if (!rawName || rawName.length > 100) {
                errors.push({
                    row: rowNumber,
                    name: rawName || "(empty)",
                    reason: !rawName ? "Name is required" : "Name too long",
                });
                continue;
            }

            const nameLower = rawName.toLowerCase();

            if (seenInFile.has(nameLower)) {
                errors.push({ row: rowNumber, name: rawName, reason: "Duplicate within this file" });
                continue;
            }
            seenInFile.add(nameLower);

            if (existingNames.has(nameLower)) {
                skipped++;
                continue;
            }

            const name = validate.toTitleCase(rawName);
            try {
                await collection.insertOne({ name, createdAt: now, updatedAt: now });
                existingNames.add(nameLower); // prevent race within same import batch
                added++;
            } catch (insertErr) {
                if (insertErr.code === 11000) {
                    skipped++;
                } else {
                    errors.push({ row: rowNumber, name: rawName, reason: "Insert failed unexpectedly" });
                }
            }
        }

        res.json({ added, skipped, errorCount: errors.length, errors });

    } catch (error) {
        res.status(500).json({
            message: "Import failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};



/* ═══════════════════════ EXPORT REFERENCE DATA CSV ════════════════════════ */
// Returns all entries for a type as a single-column CSV download.
// Used by the admin UI to export genres, languages, or houses.

exports.exportRefCSV = async (req, res) => {
    try {
        const { type } = req.params;

        if (!["genres", "languages", "houses"].includes(type)) {
            return res.status(400).json({ message: "Invalid reference data type" });
        }

        const collection = type === "genres" ? getGenres() : type === "houses" ? getHouses() : getLanguages();
        const items = await collection.find({}, { projection: { name: 1 } }).sort({ name: 1 }).toArray();

        const csv = ["name", ...items.map((i) => i.name)].join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${type}.csv"`);
        res.send(csv);

    } catch (error) {
        res.status(500).json({
            message: "Export failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}