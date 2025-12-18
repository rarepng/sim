cmake_minimum_required(VERSION 4.0)
project(sim LANGUAGES CXX)


set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(CMAKE_CXX_SCAN_FOR_MODULES OFF)


file(GLOB PROJECT_SOURCES "src/main.cpp" "src/*/*.cpp")

add_executable(sim ${PROJECT_SOURCES})


if(EMSCRIPTEN)
    set_target_properties(sim PROPERTIES SUFFIX ".js")

    # Linker flags (The arguments we previously passed to em++)
    target_link_options(sim PRIVATE
        -O3
        -lembind                     # Bindings
        -sMODULARIZE=1               # Module format
        -sALLOW_MEMORY_GROWTH=1      # Dynamic memory
        -sEXPORTED_RUNTIME_METHODS=['HEAPF32'] # Expose memory view
    )
    
    # Compiler flags (Optimization)
    target_compile_options(sim PRIVATE -O3)
else()
    # Optional: Logic for a native build (non-Wasm) could go here
    message(WARNING "Not building for Emscripten! This might not run.")
endif()
