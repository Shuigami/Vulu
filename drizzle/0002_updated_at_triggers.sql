-- Hand-written: drizzle-kit does not manage triggers.
CREATE TRIGGER users_touch   BEFORE UPDATE ON users           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER media_touch   BEFORE UPDATE ON media           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER library_touch BEFORE UPDATE ON library_entries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint
CREATE TRIGGER lists_touch   BEFORE UPDATE ON lists           FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
