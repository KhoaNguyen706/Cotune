# Cotune — backend

Real-time collaborative music editor. Backend: Spring Boot (Java 21), PostgreSQL, GraphQL. Redis pub/sub + WebSocket arrive in later sessions.

## Run locally

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Run the app (Flyway migrates the schema on startup)
./mvnw spring-boot:run
```

- GraphQL endpoint: `POST http://localhost:8080/graphql`
- GraphiQL IDE (explore the API in the browser): http://localhost:8080/graphiql

## Try it

```graphql
mutation {
  createSong(input: { title: "Midnight Sketch", bpm: 92, timeSignature: "3/4" }) {
    id
    title
    bpm
    version
    createdAt
  }
}
```

```graphql
mutation {
  addTrack(input: { songId: "<id from createSong>", name: "Lead Synth", instrument: SYNTH }) {
    id
    position
    instrument
  }
}
```

```graphql
query {
  songs {
    id
    title
    bpm
    tracks {        # resolved in ONE batched query for all songs (@BatchMapping)
      name
      instrument
      position
    }
  }
}
```

## Architecture (sessions 1–2)

Package-by-feature (`com.cotune.song`, `com.cotune.track`), classic layering inside each feature:

```
GraphQL request
  → SongGraphqlController   (transport adapter: schema field ↔ method, validation)
  → SongService / Impl      (use cases, transaction boundaries)
  → SongRepository          (Spring Data JPA)
  → PostgreSQL              (schema owned by Flyway migrations)

SongMapper translates Entity ↔ DTO at the service boundary;
entities never cross the API surface.
```

Schema contract: `src/main/resources/graphql/schema.graphqls`.
