import { beforeAll, describe, expect, it } from "vitest";
import { writeAudit } from "@/modules/audit/audit.repo";
import {
  deleteContact,
  findDuplicates,
  getContact,
  getContactsByIds,
  insertContacts,
  listAllContacts,
  listContacts,
  listCreators,
  listValues,
  quickSearch,
  searchContacts,
  updateContact,
} from "@/modules/contacts/contacts.repo";
import { ListContactsQuery, type Contact } from "@/modules/contacts/contact.schema";
import { exportForAccess } from "@/modules/contacts/export";
import { cleanContact } from "@/modules/contacts/normalize";
import { contactVcard } from "@/modules/contacts/vcard";
import { collections } from "@/modules/db/mongo";
import { GET as listRoute, POST as saveRoute } from "@/app/api/contacts/route";
import { PATCH as patchRoute } from "@/app/api/contacts/[id]/route";
import {
  contact,
  jsonRequest,
  makeWorld,
  params,
  read,
  signInAs,
  waitFor,
  type World,
} from "./helpers";

// Three departments sharing some of the same phone numbers and names (plan.md §11 Phase 1).

let world: World;
let inA: Contact[];
let inB: Contact[];
let inHm: Contact[];

const SHARED_MOBILE = "07701234567";
const page = ListContactsQuery.parse({});
const names = (items: { FullName: string }[]) => items.map((item) => item.FullName).sort();

beforeAll(async () => {
  world = await makeWorld();
  const { users } = world;
  inA = await insertContacts(
    users.aEditor,
    [
      contact({
        FullName: "Mohammed Al-Saadi",
        Company: "Asiacell",
        City: "Baghdad",
        Mobile: SHARED_MOBILE,
        Email: "saadi@asiacell.test",
        Position: "Marketing Manager",
        Sector: "Businesses & Financial Institutions",
      }),
      contact({
        FullName: "أحمد الربيعي",
        Company: "جامعة بغداد",
        City: "بغداد",
        Mobile: "٠٧٨٠١١١٢٢٣٣",
        Sector: "Universities & Education",
      }),
      contact({
        FullName: "Sara Kareem",
        Company: "Alpha Trading",
        City: "Erbil",
        Mobile: "07901110001",
        Email: "sara@alpha.test",
      }),
    ],
    "manual",
  );
  inB = await insertContacts(
    users.bEditor,
    [
      contact({
        FullName: "Mohammed Al-Saadi",
        Company: "Beta Secret Holdings",
        City: "Basra",
        Mobile: SHARED_MOBILE,
        Email: "m.saadi@beta.test",
      }),
      contact({
        FullName: "Omar Hidden",
        Company: "Beta Secret Holdings",
        City: "Kirkuk",
        Mobile: "07802220002",
        Email: "omar@beta.test",
      }),
    ],
    "manual",
  );
  inHm = await insertContacts(
    users.hmEditor,
    [
      contact({
        FullName: "Layla Board",
        Company: "Presidency Office",
        City: "Baghdad",
        Mobile: "07713330003",
        Email: "layla@hm.test",
      }),
    ],
    "manual",
  );
  // Wait until Atlas Search has indexed all six.
  await waitFor(
    () => quickSearch({ kind: "all" }, "Mohammed"),
    (found) => found.total >= 2,
  );
  await waitFor(
    () => quickSearch({ kind: "all" }, "Layla"),
    (found) => found.total >= 1,
  );
}, 300_000);

describe("department scope: every place contacts can come out", () => {
  it("table and totals (listContacts)", async () => {
    const a = await listContacts(world.users.aEditor.scope, page);
    expect(a.total).toBe(3);
    expect(names(a.items)).toEqual(names(inA));
    const all = await listContacts(world.users.admin.scope, page);
    expect(all.total).toBe(6);
  });

  it("a DepartmentId filter can only narrow a department user's scope", async () => {
    const asA = await listContacts(world.users.aEditor.scope, {
      ...page,
      DepartmentId: world.b._id.toHexString(),
    });
    expect(asA.total).toBe(0);
    const asHm = await listContacts(world.users.admin.scope, {
      ...page,
      DepartmentId: world.b._id.toHexString(),
    });
    expect(asHm.total).toBe(2);
  });

  it("quick search: phone branch and its total", async () => {
    const a = await quickSearch(world.users.aEditor.scope, "0770 123");
    expect(a.total).toBe(1);
    expect(a.items[0].Company).toBe("Asiacell");
    const all = await quickSearch(world.users.admin.scope, "0770 123");
    expect(all.total).toBe(2);
    // Arabic-Indic digits find the same number.
    const arabic = await quickSearch(world.users.aEditor.scope, "٠٧٨٠١١١");
    expect(names(arabic.items)).toEqual(["أحمد الربيعي"]);
  });

  it("quick search: email branch and its total", async () => {
    const a = await quickSearch(world.users.aEditor.scope, "saadi@");
    expect(a.total).toBe(1);
    expect(a.items[0].Email).toBe("saadi@asiacell.test");
    expect((await quickSearch(world.users.aEditor.scope, "@beta.test")).total).toBe(0);
    expect((await quickSearch(world.users.admin.scope, "@beta.test")).total).toBe(2);
  });

  it("quick search: text branch ($search) and its total ($searchMeta)", async () => {
    const a = await quickSearch(world.users.aEditor.scope, "Mohammed");
    expect(a.total).toBe(1);
    expect(a.items.map((item) => item.Company)).toEqual(["Asiacell"]);
    const hidden = await quickSearch(world.users.aEditor.scope, "Beta Secret");
    expect(hidden).toEqual({ items: [], total: 0 });
    const board = await quickSearch(world.users.aEditor.scope, "Layla");
    expect(board).toEqual({ items: [], total: 0 });
    const all = await quickSearch(world.users.admin.scope, "Mohammed");
    expect(all.total).toBe(2);
  });

  it("quick search finds prefixes, typos and Arabic letter variants", async () => {
    const scope = world.users.aEditor.scope;
    expect((await quickSearch(scope, "Moh")).items[0].FullName).toBe("Mohammed Al-Saadi");
    expect((await quickSearch(scope, "Mohamad")).items[0].FullName).toBe("Mohammed Al-Saadi");
    expect((await quickSearch(scope, "احمد")).items[0].FullName).toBe("أحمد الربيعي");
  });

  it("quick search survives regex characters and does not return everything", async () => {
    const scope = world.users.admin.scope;
    for (const q of [".*", "(", "a@.*", "\\", "+(", "(((", ".+@.+"]) {
      const found = await quickSearch(scope, q);
      expect(found.items.length, q).toBe(0);
    }
    // Letters inside regex syntax are searched as plain text, never run as a pattern.
    expect((await quickSearch(scope, "[a-z]+")).total).toBeLessThan(6);
    const only964 = await quickSearch(scope, "964");
    expect(only964.total).toBe(6); // every stored number is Iraqi here: matched, not failed
    expect((await quickSearch(world.users.aEditor.scope, "964")).total).toBe(3);
    expect((await quickSearch(scope, "0")).total).toBe(0);
  });

  it("Ask AI's reads: searchContacts, listValues, getContactsByIds", async () => {
    const a = world.users.aEditor.scope;
    expect(names(await searchContacts(a, { FullName: "Mohammed" }))).toEqual(["Mohammed Al-Saadi"]);
    expect((await searchContacts(a, { FullName: "Mohammed" }))[0].Company).toBe("Asiacell");
    expect(await searchContacts(a, { Company: "Beta Secret Holdings" })).toEqual([]);
    expect(await searchContacts(a, { text: "Omar" })).toEqual([]);
    expect((await searchContacts(a, {})).length).toBe(3);
    expect((await searchContacts(world.users.admin.scope, {})).length).toBe(6);
    expect((await searchContacts(world.users.admin.scope, { Company: "Beta Secret" })).length).toBe(
      2,
    );

    const companies = (await listValues(a, "Company")).map((row) => row.value);
    expect(companies).not.toContain("Beta Secret Holdings");
    expect(companies).not.toContain("Presidency Office");
    const cities = (await listValues(a, "City")).map((row) => row.value);
    expect(cities).not.toContain("Kirkuk");
    expect(
      (await listValues(world.users.admin.scope, "Company")).map((row) => row.value),
    ).toContain("Beta Secret Holdings");

    const ids = [
      inB[0].id,
      inA[1].id,
      "not-an-id",
      inHm[0].id,
      inA[0].id,
      "5f5f5f5f5f5f5f5f5f5f5f5f",
    ];
    expect((await getContactsByIds(a, ids)).map((item) => item.id)).toEqual([inA[1].id, inA[0].id]);
    expect((await getContactsByIds(world.users.admin.scope, ids)).length).toBe(4);
  });

  it("CSV export: table, quick search and ids", async () => {
    const table = await exportForAccess(world.users.aEditor, {});
    expect(table.count).toBe(3);
    expect(table.csv).not.toContain("Beta Secret");
    expect(table.csv).not.toContain("Layla");
    expect(table.csv).not.toContain('"Department"');

    const search = await exportForAccess(world.users.aEditor, { q: "Beta Secret" });
    expect(search.count).toBe(0);
    const byIds = await exportForAccess(world.users.aEditor, {
      ids: [inB[0].id, inB[1].id, inA[2].id].join(","),
    });
    expect(byIds.count).toBe(1);
    expect(byIds.csv).toContain("Sara Kareem");
    expect(byIds.csv).not.toContain("Omar");

    const hm = await exportForAccess(world.users.admin, {});
    expect(hm.count).toBe(6);
    expect(hm.csv).toContain('"Department"');
    expect(hm.csv).toContain('"Dept B"');
    expect((await listAllContacts(world.users.aEditor.scope, {})).length).toBe(3);

    const log = await collections().audit.find({ action: "export" }).sort({ at: 1 }).toArray();
    expect(log.map((entry) => entry.detail)).toEqual([
      "Table: all",
      "Search: Beta Secret",
      "AI search results",
      "Table: all",
    ]);
    expect(log[0].count).toBe(3);
  });

  it("filter lists: who added contacts", async () => {
    const a = await listCreators(world.users.aEditor.scope);
    expect(a.map((row) => row.username)).toEqual([world.users.aEditor.user.username]);
    expect(a[0].count).toBe(3);
    expect((await listCreators(world.users.admin.scope)).length).toBe(3);
  });

  it("opening by id, vCard, edit and delete return NOT_FOUND and change nothing", async () => {
    const a = world.users.aEditor;
    const foreign = [inB[1].id, inHm[0].id];
    for (const id of foreign) {
      await expect(getContact(a.scope, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(contactVcard(a.scope, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(updateContact(a, id, { City: "Hacked" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(deleteContact(a, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(getContact(a.scope, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getContact(world.users.admin.scope, inB[1].id)).City).toBe("Kirkuk");
    expect((await getContact(world.users.admin.scope, inHm[0].id)).FullName).toBe("Layla Board");
    expect((await contactVcard(a.scope, inA[0].id)).body).toContain("FN:Mohammed Al-Saadi");
  });

  it("duplicate warning: own department only", async () => {
    const candidate = [cleanContact(contact({ FullName: "Someone New", Mobile: SHARED_MOBILE }))];
    const asA = await findDuplicates(world.a._id, candidate);
    expect(asA[0].duplicateOfName).toBe("Mohammed Al-Saadi");
    expect(asA[0].duplicateOfId).toBe(inA[0].id);

    // Omar exists only in B: no warning in A, so his name is not revealed.
    const omar = [
      cleanContact(contact({ FullName: "X", Mobile: "07802220002", Email: "omar@beta.test" })),
    ];
    expect((await findDuplicates(world.a._id, omar))[0].duplicateOfId).toBeUndefined();
    expect((await findDuplicates(world.b._id, omar))[0].duplicateOfName).toBe("Omar Hidden");

    const batch = [
      cleanContact(contact({ FullName: "First", Mobile: "07905550001" })),
      cleanContact(contact({ FullName: "Second", Email: "second@x.test" })),
      cleanContact(contact({ FullName: "First again", Mobile: "0790 555 0001" })),
      cleanContact(contact({ FullName: "No keys" })),
    ];
    const marks = await findDuplicates(world.a._id, batch);
    expect(marks.map((mark) => mark.duplicateInBatch)).toEqual([
      undefined,
      undefined,
      0,
      undefined,
    ]);
  });

  it("a contact with no DepartmentId is visible only to High Management", async () => {
    const [orphan] = await insertContacts(
      world.users.hmEditor,
      [contact({ FullName: "Orphan Person", Mobile: "07999990000" })],
      "manual",
    );
    const { ObjectId } = await import("mongodb");
    await collections().contacts.updateOne(
      { _id: new ObjectId(orphan.id) },
      { $unset: { DepartmentId: "" } },
    );
    await expect(getContact(world.users.aEditor.scope, orphan.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await getContact(world.users.admin.scope, orphan.id)).DepartmentId).toBeNull();
    expect((await quickSearch(world.users.aEditor.scope, "0799999")).total).toBe(0);
    await deleteContact(world.users.admin, orphan.id);
  });
});

describe("writes", () => {
  it("a High Management editor can edit a contact in A (it stays in A) and delete it", async () => {
    const [temp] = await insertContacts(
      world.users.aEditor,
      [contact({ FullName: "Temp Person", Mobile: "07906660006" })],
      "manual",
    );
    const edited = await updateContact(world.users.hmEditor, temp.id, {
      City: "Mosul",
      Mobile: "0790 666 0007",
    });
    expect(edited.City).toBe("Mosul");
    expect(edited.Mobile).toBe("+9647906660007");
    expect(edited.DepartmentId).toBe(world.a._id.toHexString());
    const stored = await getContact(world.users.aEditor.scope, temp.id);
    expect(stored.City).toBe("Mosul");
    expect((await quickSearch(world.users.aEditor.scope, "0790666")).items[0].id).toBe(temp.id);
    expect(await deleteContact(world.users.hmEditor, temp.id)).toEqual({ deleted: temp.id });
    await expect(getContact(world.users.admin.scope, temp.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const log = await collections()
      .audit.find({ contactName: "Temp Person" })
      .sort({ at: 1, _id: 1 })
      .toArray();
    expect(log.map((entry) => entry.action)).toEqual(["create", "update", "delete"]);
    expect(log[1].before).toMatchObject({ City: "" });
    expect(log[1].before).not.toHaveProperty("_mobiles");
    expect(log[1].username).toBe(world.users.hmEditor.user.username);
  });

  it("refuses an invalid email on insert and update", async () => {
    await expect(
      insertContacts(world.users.aEditor, [contact({ FullName: "Bad", Email: "bad@" })], "manual"),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Not a valid email: bad@. Fix it or clear the field.",
    });
    await expect(
      updateContact(world.users.aEditor, inA[2].id, { Email: "nope" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await getContact(world.users.aEditor.scope, inA[2].id)).Email).toBe("sara@alpha.test");
  });

  it("DepartmentId sent in a save or edit request is ignored", async () => {
    signInAs(world.users.aEditor);
    const saved = await read<Contact[]>(
      await saveRoute(
        jsonRequest("/api/contacts", "POST", {
          source: "manual",
          contacts: [
            { FullName: "Injected", DepartmentId: world.b._id.toHexString(), CreatedBy: "x" },
          ],
        }),
      ),
    );
    expect(saved.status).toBe(201);
    const id = saved.body.data[0].id;
    expect(saved.body.data[0].DepartmentId).toBe(world.a._id.toHexString());

    const patched = await read<Contact>(
      await patchRoute(
        jsonRequest(`/api/contacts/${id}`, "PATCH", {
          City: "Najaf",
          DepartmentId: world.b._id.toHexString(),
        }),
        params({ id }),
      ),
    );
    expect(patched.status).toBe(200);
    expect(patched.body.data.DepartmentId).toBe(world.a._id.toHexString());
    expect((await listContacts(world.users.bEditor.scope, page)).total).toBe(2);
    await deleteContact(world.users.aEditor, id);
  });

  it("the list route applies the session's scope and never caches", async () => {
    signInAs(world.users.aViewer);
    const response = await listRoute(
      jsonRequest(`/api/contacts?DepartmentId=${world.b._id.toHexString()}`, "GET"),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { body } = await read<{ total: number }>(response);
    expect(body.data.total).toBe(0);
  });

  it("the audit list never returns the previous document", async () => {
    await writeAudit([]);
    const { listAudit } = await import("@/modules/audit/audit.repo");
    const { items, total } = await listAudit({ page: 1, pageSize: 100 });
    expect(total).toBeGreaterThan(5);
    for (const item of items) expect(item).not.toHaveProperty("before");
  });
});
