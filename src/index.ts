import app from "./server";

app.set("trust proxy", 1); // Railway / proxies

const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`Server listening on ${port}`));