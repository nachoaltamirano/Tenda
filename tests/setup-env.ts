import { config } from "dotenv";

config();
// Las pruebas siempre usan la base de test, nunca la de desarrollo ni la real.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Falta TEST_DATABASE_URL para ejecutar pruebas");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-test-secret";
process.env.STORAGE_LOCAL_DIR = "./storage-test";
