# How can I contribute?
## Contributing code
1. Clone the repository
2. Create your feature branch:
```shell
git checkout -b your-branch-name main
```

3. Commit your changes:
```shell
git commit -m "Short description"
```

4. Push to your branch:
```shell
git push origin your-branch-name
```

5. Open pull request

## Development setup
### Prerequisites
**OS:**
Linux or macOS

**To code:**
- `poetry`

**For docs:**
- `texlive`

### Installation
Install Python 3.12 and poetry, if they are not already installed:

**Ubuntu**
```shell
sudo apt install python3.12 python3-poetry
```

Create virtual environment and install dependencies:

**Ubuntu**
```shell
poetry env use python3.12
poetry install --no-root
```

## Launching
To launch the API, run:
```shell
poetry run fastapi run
```

## Documentation
### Creating
Documentation in this project uses the `reStructuredText` style. To document your function, adhere to this format:
```python
def function(parameter: type) -> returnType:
    """Short description.

    Long description that may not fit one line.  If this happens, simply
    continue on the next line without blank lines.  Note, that after fullstops
    there are exactly two spaces.  Stick to that style in the comments too.

    :param parameter: Parameter description.
    :type patameter: Parameter type
    :returns: Return description.
    :rtype: Return type

    Example usage::  # "::" means code block

        result = function(example_parameter)
        print(result)  # Outputs something you know
   """

   # The rest of the fuction continues exactly here
```
