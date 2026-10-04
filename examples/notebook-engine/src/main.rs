fn main() -> std::io::Result<()> {
    browser_driver_engine::serve(notebook_engine::NotebookModel)
}
