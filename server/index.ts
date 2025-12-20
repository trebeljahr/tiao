import app from "./app";
import { PORT } from "./config/envVars";

app.listen(PORT, () => {
  console.debug(`Server listening on http://localhost:${PORT}`);
});
