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

        // No password required — new users set their own password on first login
        const nv = validate.validateName({ name });
        if (!nv.valid) return res.status(400).json({ message: nv.message });

        const ev = validate.validateEmail({ email });
        if (!ev.valid) return res.status(400).json({ message: ev.message });

        const rv = validate.validateRole({ role });
        if (!rv.valid) return res.status(400).json({ message: rv.message });

        const users = getUsers();

        // Duplicate email check
        const existing = await users.findOne({ email: email.toLowerCase().trim() });
        if (existing) {
            return res.status(400).json({ message: "A user with this email already exists" });
        }

        const now = new Date();
        const result = await users.insertOne({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: null,        // no password until first login
            firstLogin: true,      // signals the login page to prompt password setup
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

        // Only user and admin are assignable via the API — superadmin is set directly in DB
        const rv = validate.validateRole({ role });
        if (!rv.valid) return res.status(400).json({ message: rv.message });

        // Nobody can change their own role
        if (req.user.id.toString() === id) {
            return res.status(403).json({ message: "You cannot change your own role" });
        }

        const users = getUsers();

        // Look up the target user to enforce protection rules
        const target = await users.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).json({ message: "User not found" });

        // Superadmin's role is permanently protected — nobody can change it
        if (target.role === "superadmin") {
            return res.status(403).json({ message: "The super admin's role cannot be changed" });
        }

        // Admins can only assign user/admin roles — not superadmin (already blocked by validateRole)
        // Admins cannot touch the superadmin (already blocked above)
        // So no further checks needed for admins here

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
// Deletes the user document and cleans up all their data from books:
// - Removes their status entries from all books
// - Removes them from publicByUsers on all books
// Books themselves are kept — they are shared physical objects.

exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        // Superadmin cannot delete themselves
        if (req.user.id.toString() === id) {
            return res.status(403).json({ message: "You cannot delete your own account" });
        }

        const users = getUsers();
        const target = await users.findOne({ _id: new ObjectId(id) });
        if (!target) return res.status(404).json({ message: "User not found" });

        // Superadmin cannot be deleted
        if (target.role === "superadmin") {
            return res.status(403).json({ message: "The super admin account cannot be deleted" });
        }

        const userId = new ObjectId(id);
        const books = getBooks();

        // Clean up user data from all books atomically
        await books.updateMany(
            {},
            {
                $pull: {
                    statuses: { userId },
                    publicByUsers: userId,
                },
            }
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
// Sets passwordResetApproved: true on the target user.
// The user can then reset their password via the login page without an OTP.
// Only one approval can be active at a time — button is blocked once approved.

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
// Clears the passwordResetApproved flag — cancels a previously granted approval.

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
// Hand-rolled parser for the controlled CSV format we own.
// Handles quoted fields (including quoted commas) and trims whitespace.
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
                if (line[i + 1] === '"') { current += '"'; i++; } // escaped quote
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
        if (!line) continue; // skip blank lines
        const values = parseRow(line);
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
        rows.push({ rowNumber: i + 1, data: row });
    }

    return { headers, rows };
}

// Normalises a parsed row into the shape validateCSVRow and the DB expect
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


/* ═══════════════════════ VALIDATE CSV ══════════════════════════════════════ */
// Runs all checks without writing to the DB.
// Returns a preview: validCount, errors array, and the parsed valid rows
// (stored server-side in the response so the confirm step can re-use them).

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
            return res.status(400).json({
                message: `CSV is missing required columns: ${missingHeaders.join(", ")}`,
            });
        }

        if (rows.length === 0) {
            return res.status(400).json({ message: "CSV has no data rows" });
        }

        if (rows.length > 500) {
            return res.status(400).json({ message: "CSV cannot exceed 500 rows per upload" });
        }

        // Load valid reference data sets once — used for all row checks
        const [genreDocs, houseDocs, languageDocs] = await Promise.all([
            getGenres().find({}).toArray(),
            getHouses().find({}).toArray(),
            getLanguages().find({}).toArray(),
        ]);

        const validGenres = new Set(genreDocs.map((g) => g.name.toLowerCase()));
        const validHouses = new Set(houseDocs.map((h) => h.name.toLowerCase()));
        const validLanguages = new Set(languageDocs.map((l) => l.name.toLowerCase()));

        // Track titles seen within this CSV for intra-file duplicate detection
        const seenInFile = new Map(); // "title::author" → rowNumber

        const errors = [];
        const validRows = [];

        for (const { rowNumber, data } of rows) {
            const norm = normaliseRow(data);
            const rowErrors = [];

            // 1. Field validation
            const fv = validate.validateCSVRow(norm);
            if (!fv.valid) { rowErrors.push(fv.message); }

            if (rowErrors.length === 0) {
                // 2. Reference data validation
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

                // 3. Intra-file duplicate check
                const key = `${norm.title.toLowerCase()}::${norm.author.toLowerCase()}`;
                if (seenInFile.has(key)) {
                    rowErrors.push(`Duplicate of row ${seenInFile.get(key)} in this file`);
                } else {
                    seenInFile.set(key, rowNumber);
                }

                // 4. DB duplicate check — uses the compound index via findOne
                if (rowErrors.length === 0) {
                    const books = getBooks();
                    const existing = await books.findOne(
                        {
                            title: { $regex: `^${escapeRegex(norm.title)}$`, $options: "i" },
                            author: { $regex: `^${escapeRegex(norm.author)}$`, $options: "i" }
                        },
                        { projection: { _id: 1 } }
                    );
                    if (existing) {
                        rowErrors.push(`"${norm.title}" by ${norm.author} already exists in the library`);
                    }
                }
            }

            if (rowErrors.length > 0) {
                errors.push({
                    row: rowNumber,
                    title: norm.title || "(no title)",
                    reasons: rowErrors,
                });
            } else {
                validRows.push(norm);
            }
        }

        res.json({
            validCount: validRows.length,
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


/* ═══════════════════════ IMPORT CSV ════════════════════════════════════════ */
// Re-validates each row (safety net) then inserts valid ones.
// stopOnError: if true, stops at the first error and rolls back nothing
// (insertions already done are kept — MongoDB has no transaction rollback here).
// Since validate runs first, errors at this stage are rare edge cases.

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
            return res.status(400).json({
                message: `CSV is missing required columns: ${missingHeaders.join(", ")}`,
            });
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
                            author: { $regex: `^${escapeRegex(norm.author)}$`, $options: "i" }
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

            // Find canonical casing from reference data
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
                // Catch unique index violation as final safety net
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


// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}