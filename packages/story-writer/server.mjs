const PACKAGE_ID = "story-writer";
const KIND = "hello";

export async function activate({ api }) {
  const documents = api.runtime.persistence.documents;
  const cleanupRoutes = await api.registerPrivilegedRoutes(
    async (app) => {
      const find = async () => (await documents.list(PACKAGE_ID, KIND))[0] ?? null;
      app.get("/hello", async () => ({ count: (await find())?.data?.count ?? 0 }));
      app.post("/hello", async () => {
        const now = new Date().toISOString();
        const current = await find();
        const count = (current?.data?.count ?? 0) + 1;
        if (current) {
          await documents.update({
            id: current.id,
            packageId: PACKAGE_ID,
            expectedRevision: current.revision,
            name: current.name,
            description: current.description,
            data: { count },
            updatedAt: now,
          });
        } else {
          await documents.create({
            id: crypto.randomUUID(),
            packageId: PACKAGE_ID,
            kind: KIND,
            name: "hello",
            description: "Install check counter",
            data: { count },
            createdAt: now,
            updatedAt: now,
          });
        }
        return { count };
      });
    },
    { prefix: `/api/${PACKAGE_ID}` },
  );
  return () => cleanupRoutes();
}
